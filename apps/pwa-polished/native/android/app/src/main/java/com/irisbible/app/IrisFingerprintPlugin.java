package com.irisbible.app;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleEventObserver;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.Enumeration;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The journal lock's fingerprint in the app.
 *
 * On the web the fingerprint is a passkey that hands the page a secret
 * (WebAuthn PRF). The app's web view has no passkeys, so the phone keeps a key
 * of its own instead: an AES key made inside Android's keystore, which never
 * leaves the phone's secure hardware and which Android only lets the app use
 * right after the fingerprint (or, on Android 11 and later, the phone's PIN,
 * pattern or password) is given. That key locks a copy of the journal key,
 * and the locked copy is kept as one of the journal lock's key slots, beside
 * the passkeys and the recovery code (src/lib/journalLock/phoneFingerprint.ts).
 *
 * The page calls this through that file.
 *
 *  status   whether a fingerprint can be used ("ready", "not-enrolled",
 *           "no-hardware", "unavailable") and the ids of the keys this phone
 *           holds.
 *  create   makes a key for `id`, asks for the fingerprint, and locks
 *           `secret` with it. Gives back the locked copy.
 *  open     asks for the fingerprint and unlocks a locked copy.
 *  remove   deletes a key, so its locked copy can never be opened again.
 *  cancel   closes a fingerprint prompt that's showing.
 *
 * Failures come back with a code: "cancelled" (closed, or Cancel pressed),
 * "missing" (no key for that id here), "reset" (Android threw the key away:
 * the screen lock was removed or changed), "no-match" (the key doesn't open
 * that copy), "locked-out" (too many tries), "not-enrolled", "busy" or
 * "failed". Every word the prompt shows comes from the page.
 */
@CapacitorPlugin(name = "IrisFingerprint")
public class IrisFingerprintPlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS_PREFIX = "irisJournal.";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    /** The prompt that's showing, so a second one can't stack on it and cancel can close it. */
    private BiometricPrompt showing;

    // ── Keys ────────────────────────────────────────────────────────────────

    private static boolean validId(String id) {
        return id != null && id.matches("[A-Za-z0-9-]{8,64}");
    }

    private static KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        return store;
    }

    /**
     * A new key that only works right after the fingerprint. From Android 11
     * the phone's PIN, pattern or password also opens it, as it does a
     * passkey; before that, only the fingerprint can.
     *
     * Adding another fingerprint later doesn't throw it away: whoever can add
     * one already knows the screen lock, which opens it anyway.
     */
    private static SecretKey makeKey(String id) throws Exception {
        String alias = ALIAS_PREFIX + id;
        KeyStore store = keyStore();
        if (store.containsAlias(alias)) store.deleteEntry(alias);

        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 0 = every single use needs its own fingerprint.
            spec.setUserAuthenticationParameters(
                0, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL
            );
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(spec.build());
        return generator.generateKey();
    }

    private static SecretKey findKey(String id) throws Exception {
        Key key = keyStore().getKey(ALIAS_PREFIX + id, null);
        return key instanceof SecretKey ? (SecretKey) key : null;
    }

    private static void deleteKey(String id) {
        try {
            KeyStore store = keyStore();
            if (store.containsAlias(ALIAS_PREFIX + id)) store.deleteEntry(ALIAS_PREFIX + id);
        } catch (Exception e) {
            // Nothing to delete, or the keystore is unreachable; either way it can't be used.
        }
    }

    // ── What the phone can do ───────────────────────────────────────────────

    /** Fingerprint only: what the offer and Settings go by. */
    private String fingerprintState() {
        int result = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        switch (result) {
            case BiometricManager.BIOMETRIC_SUCCESS: return "ready";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: return "not-enrolled";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: return "no-hardware";
            default: return "unavailable";
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSArray keys = new JSArray();
        try {
            Enumeration<String> aliases = keyStore().aliases();
            while (aliases.hasMoreElements()) {
                String alias = aliases.nextElement();
                if (alias.startsWith(ALIAS_PREFIX)) keys.put(alias.substring(ALIAS_PREFIX.length()));
            }
        } catch (Exception e) {
            // Listed as none.
        }
        JSObject out = new JSObject();
        out.put("state", fingerprintState());
        out.put("keys", keys);
        call.resolve(out);
    }

    // ── Locking and unlocking ───────────────────────────────────────────────

    @PluginMethod
    public void create(PluginCall call) {
        String id = call.getString("id");
        byte[] secret = decode(call.getString("secret"));
        if (!validId(id) || secret == null || secret.length == 0) {
            call.reject("Missing key id or secret", "failed");
            return;
        }
        Cipher cipher;
        try {
            SecretKey key = makeKey(id);
            cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);
        } catch (Exception e) {
            deleteKey(id);
            call.reject("Couldn't make a fingerprint key: " + e, "failed");
            return;
        }
        byte[] aad = aadOf(call);
        ask(call, cipher, new Done() {
            @Override
            public void ok(Cipher authed) throws Exception {
                authed.updateAAD(aad);
                byte[] sealed = authed.doFinal(secret);
                byte[] iv = authed.getIV();
                byte[] out = new byte[iv.length + sealed.length];
                System.arraycopy(iv, 0, out, 0, iv.length);
                System.arraycopy(sealed, 0, out, iv.length, sealed.length);
                Arrays.fill(secret, (byte) 0);
                JSObject result = new JSObject();
                result.put("wrapped", Base64.encodeToString(out, Base64.NO_WRAP));
                call.resolve(result);
            }

            @Override
            public void failed() {
                // A key that never locked anything is no use to keep.
                Arrays.fill(secret, (byte) 0);
                deleteKey(id);
            }
        });
    }

    @PluginMethod
    public void open(PluginCall call) {
        String id = call.getString("id");
        byte[] wrapped = decode(call.getString("wrapped"));
        if (!validId(id) || wrapped == null || wrapped.length <= IV_BYTES) {
            call.reject("Missing key id or locked copy", "failed");
            return;
        }
        Cipher cipher;
        try {
            SecretKey key = findKey(id);
            if (key == null) {
                call.reject("This phone has no fingerprint key for the journal", "missing");
                return;
            }
            cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, wrapped, 0, IV_BYTES));
        } catch (KeyPermanentlyInvalidatedException e) {
            deleteKey(id);
            call.reject("Android reset the fingerprint key", "reset");
            return;
        } catch (Exception e) {
            call.reject("Couldn't use the fingerprint key: " + e, "failed");
            return;
        }
        byte[] aad = aadOf(call);
        ask(call, cipher, new Done() {
            @Override
            public void ok(Cipher authed) throws Exception {
                authed.updateAAD(aad);
                byte[] plain;
                try {
                    plain = authed.doFinal(wrapped, IV_BYTES, wrapped.length - IV_BYTES);
                } catch (AEADBadTagException e) {
                    call.reject("That key doesn't open this journal", "no-match");
                    return;
                }
                JSObject result = new JSObject();
                result.put("secret", Base64.encodeToString(plain, Base64.NO_WRAP));
                Arrays.fill(plain, (byte) 0);
                call.resolve(result);
            }

            @Override
            public void failed() {}
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id");
        if (validId(id)) deleteKey(id);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            if (showing != null) showing.cancelAuthentication();
            call.resolve();
        });
    }

    // ── The prompt ──────────────────────────────────────────────────────────

    private interface Done {
        /** The fingerprint was given: finish with the cipher it unlocked. */
        void ok(Cipher authed) throws Exception;

        /** Canceled or refused, after the call has been rejected. */
        void failed();
    }

    /**
     * Shows Android's fingerprint prompt for one use of `cipher`. If the app
     * isn't on screen yet (the page asked while the app was coming back), it
     * waits until it is, since Android can only show the prompt over a
     * visible app.
     */
    private void ask(PluginCall call, Cipher cipher, Done done) {
        getBridge().executeOnMainThread(() -> {
            if (showing != null) {
                call.reject("A fingerprint prompt is already showing", "busy");
                done.failed();
                return;
            }
            FragmentActivity activity = getActivity();
            if (activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
                show(activity, call, cipher, done);
                return;
            }
            activity.getLifecycle().addObserver(new LifecycleEventObserver() {
                @Override
                public void onStateChanged(@NonNull androidx.lifecycle.LifecycleOwner source, @NonNull Lifecycle.Event event) {
                    if (event == Lifecycle.Event.ON_RESUME) {
                        source.getLifecycle().removeObserver(this);
                        if (showing != null) {
                            call.reject("A fingerprint prompt is already showing", "busy");
                            done.failed();
                        } else {
                            show(activity, call, cipher, done);
                        }
                    } else if (event == Lifecycle.Event.ON_DESTROY) {
                        source.getLifecycle().removeObserver(this);
                        call.reject("The app closed", "cancelled");
                        done.failed();
                    }
                }
            });
        });
    }

    private void show(FragmentActivity activity, PluginCall call, Cipher cipher, Done done) {
        BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(call.getString("title", "irisBible journal"))
            .setConfirmationRequired(false);
        String subtitle = call.getString("subtitle", "");
        if (subtitle != null && !subtitle.isEmpty()) info.setSubtitle(subtitle);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // The PIN, pattern or password is offered beside the fingerprint,
            // and Android draws its own way out of the prompt.
            info.setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            );
        } else {
            info.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setNegativeButtonText(call.getString("cancel", "Cancel"));
        }

        BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    showing = null;
                    BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                    Cipher authed = crypto == null ? null : crypto.getCipher();
                    if (authed == null) {
                        call.reject("The fingerprint didn't unlock the key", "failed");
                        done.failed();
                        return;
                    }
                    try {
                        done.ok(authed);
                    } catch (Exception e) {
                        call.reject("The fingerprint key failed: " + e, "failed");
                        done.failed();
                    }
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence message) {
                    showing = null;
                    call.reject(message.toString(), codeFor(errorCode));
                    done.failed();
                }

                // onAuthenticationFailed (a finger that isn't enrolled) needs
                // nothing: the prompt stays up and says so itself.
            });
        showing = prompt;
        try {
            prompt.authenticate(info.build(), new BiometricPrompt.CryptoObject(cipher));
        } catch (Exception e) {
            showing = null;
            call.reject("Couldn't show the fingerprint prompt: " + e, "failed");
            done.failed();
        }
    }

    private static String codeFor(int errorCode) {
        switch (errorCode) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
            case BiometricPrompt.ERROR_TIMEOUT:
                return "cancelled";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "locked-out";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
                return "not-enrolled";
            default:
                return "failed";
        }
    }

    // ── Bytes ───────────────────────────────────────────────────────────────

    private static byte[] decode(String base64) {
        if (base64 == null || base64.isEmpty()) return null;
        try {
            return Base64.decode(base64, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** What the locked copy is bound to (its slot), so it can't be moved to another one. */
    private static byte[] aadOf(PluginCall call) {
        return call.getString("aad", "").getBytes(StandardCharsets.UTF_8);
    }
}
