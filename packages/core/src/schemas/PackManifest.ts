/**
 * Pack Manifest Schema and Types
 * 
 * Production-grade manifest for pack distribution via GitHub Releases.
 * Includes versioning, signatures, compatibility checks, and dependencies.
 */

export interface PackManifest {
  /** Manifest schema version */
  manifestVersion: string;
  
  /** Manifest signature (Ed25519) - signs the entire manifest minus this field */
  manifestSignature?: string;
  
  /** List of available packs */
  packs: PackEntry[];
  
  /** Manifest creation timestamp */
  createdAt: string;
  
  /** Release tag associated with this manifest */
  releaseTag: string;
}

export interface PackEntry {
  /** Unique pack identifier */
  id: string;
  
  /** Pack type */
  type: 'translation' | 'lexicon' | 'study' | 'audio' | 'bootstrap';
  
  /** Pack version (semver) */
  version: string;
  
  /** File size in bytes */
  size: number;
  
  /** SHA-256 hash of the pack file */
  sha256: string;
  
  /** Pack signature (Ed25519) - signs the pack file */
  signature?: string;
  
  /** Pack schema version (for compatibility checks) */
  schemaVersion: string;
  
  /** Minimum app version required (semver) */
  minAppVersion: string;
  
  /** Download URL (GitHub Releases URL) */
  downloadUrl: string;
  
  /** Human-readable pack name */
  name: string;
  
  /** Pack description */
  description: string;
  
  /** Dependencies (other pack IDs that must be installed first) */
  dependencies?: string[];
  
  /** Optional: Changelog for this version */
  changelog?: string;
  
  /** Optional: Compressed size (if using gzip/brotli) */
  compressedSize?: number;
}

/**
 * Validate a pack manifest
 */
export function validateManifest(manifest: any): manifest is PackManifest {
  if (!manifest || typeof manifest !== 'object') {
    return false;
  }
  
  // Check required top-level fields
  if (
    typeof manifest.manifestVersion !== 'string' ||
    !Array.isArray(manifest.packs) ||
    typeof manifest.createdAt !== 'string' ||
    typeof manifest.releaseTag !== 'string'
  ) {
    return false;
  }
  
  // Validate each pack entry
  for (const pack of manifest.packs) {
    if (!validatePackEntry(pack)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Validate a pack entry
 */
export function validatePackEntry(pack: any): pack is PackEntry {
  if (!pack || typeof pack !== 'object') {
    console.error('📦 Pack validation failed: not an object', pack);
    return false;
  }
  
  // Check required fields
  const requiredFields = [
    'id', 'type', 'version', 'size', 'sha256', 
    'schemaVersion', 'minAppVersion', 'downloadUrl', 'name', 'description'
  ];
  
  for (const field of requiredFields) {
    const value = pack[field];
    const valueType = typeof value;
    if (valueType !== 'string' && valueType !== 'number') {
      console.error(`📦 Pack validation failed for field "${field}":`, {
        value,
        type: valueType,
        packId: pack.id
      });
      return false;
    }
  }
  
  // Validate type
  const validTypes = ['translation', 'lexicon', 'study', 'audio', 'bootstrap'];
  if (!validTypes.includes(pack.type)) {
    return false;
  }
  
  // Validate size is a number
  if (typeof pack.size !== 'number' || pack.size < 0) {
    return false;
  }
  
  // Validate SHA-256 format (64 hex characters)
  if (!/^[a-f0-9]{64}$/i.test(pack.sha256)) {
    return false;
  }
  
  // Validate dependencies if present
  if (pack.dependencies !== undefined) {
    if (!Array.isArray(pack.dependencies)) {
      return false;
    }
    for (const dep of pack.dependencies) {
      if (typeof dep !== 'string') {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Check if a pack is compatible with the current app version
 */
export function isPackCompatible(pack: PackEntry, appVersion: string): boolean {
  // Simple semver comparison (major.minor.patch)
  const parseVersion = (v: string) => {
    const parts = v.split('.').map(Number);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };
  
  const app = parseVersion(appVersion);
  const required = parseVersion(pack.minAppVersion);
  
  // App version must be >= required version
  if (app.major < required.major) return false;
  if (app.major === required.major && app.minor < required.minor) return false;
  if (app.major === required.major && app.minor === required.minor && app.patch < required.patch) return false;
  
  return true;
}

/**
 * Get pack dependencies in installation order
 */
export function resolveDependencies(
  packId: string,
  manifest: PackManifest,
  resolved: Set<string> = new Set()
): string[] {
  const pack = manifest.packs.find(p => p.id === packId);
  
  if (!pack) {
    throw new Error(`Pack not found: ${packId}`);
  }
  
  if (resolved.has(packId)) {
    return []; // Already resolved (prevent cycles)
  }
  
  const dependencies: string[] = [];
  
  // Resolve dependencies first
  if (pack.dependencies) {
    for (const depId of pack.dependencies) {
      if (resolved.has(depId)) continue;
      
      const depDependencies = resolveDependencies(depId, manifest, resolved);
      dependencies.push(...depDependencies);
      
      if (!dependencies.includes(depId)) {
        dependencies.push(depId);
      }
      
      resolved.add(depId);
    }
  }
  
  // Add this pack
  if (!dependencies.includes(packId)) {
    dependencies.push(packId);
  }
  
  resolved.add(packId);
  
  return dependencies;
}
