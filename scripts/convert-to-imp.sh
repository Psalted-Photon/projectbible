#!/bin/bash
# Convert SWORD modules to IMP format then to OSIS

MODULES="Barnes CalvinCommentaries Family TFG TSK"

RAW_DIR="/mnt/c/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/raw"
IMP_DIR="/mnt/c/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/imp"
OSIS_DIR="/mnt/c/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/osis"

mkdir -p "$IMP_DIR"
mkdir -p "$OSIS_DIR"

echo "Converting SWORD modules via IMP format..."
echo ""

# Install modules to SWORD directory
echo "Installing modules to SWORD..."
sudo mkdir -p /usr/share/sword/mods.d
sudo mkdir -p /usr/share/sword/modules

for moddir in barnes calvincommentaries family tfg tsk; do
    if [ -d "$RAW_DIR/$moddir/mods.d" ]; then
        sudo cp -r "$RAW_DIR/$moddir/mods.d"/* /usr/share/sword/mods.d/ 2>/dev/null
    fi
    if [ -d "$RAW_DIR/$moddir/modules" ]; then
        sudo cp -r "$RAW_DIR/$moddir/modules"/* /usr/share/sword/modules/ 2>/dev/null
    fi
done

echo ""

# Convert each module to IMP first
for module in $MODULES; do
    module_lower=$(echo "$module" | tr '[:upper:]' '[:lower:]')
    imp_file="$IMP_DIR/${module_lower}.imp"
    
    echo "Exporting $module to IMP..."
    
    mod2imp "$module" > "$imp_file" 2>&1
    
    if [ -f "$imp_file" ]; then
        size=$(stat -c%s "$imp_file" 2>/dev/null || stat -f%z "$imp_file" 2>/dev/null)
        size_mb=$(echo "scale=2; $size / 1048576" | bc)
        echo "  ✓ Created IMP: ${size_mb} MB"
    else
        echo "  ✗ Failed to create IMP file"
    fi
done

echo ""
echo "Conversion to IMP complete!"
