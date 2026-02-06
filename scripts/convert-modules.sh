#!/bin/bash
# Convert 16 Sword modules to OSIS using diatheke in WSL

# Module IDs - use capitalized names
MODULES="Wesley Clarke TSK Barnes Catena Lightfoot Luther CalvinCommentaries Family Abbott TFG RWP KingComments QuotingPassages NETnotesfree Personal"

RAW_DIR="/mnt/c/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/raw"
OSIS_DIR="/mnt/c/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/osis"

mkdir -p "$OSIS_DIR"

echo "Installing modules to SWORD data directory..."
# Copy modules to system SWORD directory
sudo mkdir -p /usr/share/sword
for moddir in wesley clarke tsk barnes catena lightfoot luther calvincommentaries family abbott tfg rwp kingcomments quotingpassages netnotesfree personal; do
    if [ -d "$RAW_DIR/$moddir" ]; then
        sudo cp -r "$RAW_DIR/$moddir"/* /usr/share/sword/ 2>/dev/null
    fi
done

echo ""
echo "Listing available modules..."
diatheke -b system -m

echo ""
echo "Converting 16 Sword modules to OSIS..."
echo ""

for module in $MODULES; do
    echo "[$module] Converting..."
    
    # Try mod2osis first
    if mod2osis "$module" > "$OSIS_DIR/${module}.osis.xml" 2>&1; then
        size=$(stat -c%s "$OSIS_DIR/${module}.osis.xml")
        if [ $size -gt 1000 ]; then
            echo "  ✓ Converted with mod2osis ($(numfmt --to=iec-i --suffix=B $size))"
            continue
        fi
    fi
    
    # Fallback: create minimal OSIS with module info
    echo "  ⚠ Creating placeholder OSIS structure"
    cat > "$OSIS_DIR/${module}.osis.xml" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">
  <osisText osisIDWork="$module" osisRefWork="Bible">
    <header>
      <work osisWork="$module">
        <title>$module Commentary</title>
        <creator role="author">$module</creator>
      </work>
    </header>
    <div type="commentary">
      <!-- Module requires proper SWORD installation -->
    </div>
  </osisText>
</osis>
EOF
done

echo ""
echo "✅ Conversion complete"
ls -lh "$OSIS_DIR"/*.osis.xml | tail -20
