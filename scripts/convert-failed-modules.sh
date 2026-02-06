#!/bin/bash
# Convert specific SWORD modules to OSIS using mod2osis

MODULES="Barnes CalvinCommentaries Family TFG TSK"

RAW_DIR="/mnt/c/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/raw"
OSIS_DIR="/mnt/c/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/osis"

mkdir -p "$OSIS_DIR"

echo "Converting SWORD modules to OSIS..."
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

# Convert each module
for module in $MODULES; do
    module_lower=$(echo "$module" | tr '[:upper:]' '[:lower:]')
    output_file="$OSIS_DIR/${module_lower}.osis.xml"
    
    echo "Converting $module..."
    
    # Use mod2osis despite the warning - it still produces usable OSIS
    mod2osis "$module" > "$output_file" 2>&1
    
    if [ -f "$output_file" ]; then
        size=$(stat -c%s "$output_file" 2>/dev/null || stat -f%z "$output_file" 2>/dev/null)
        size_mb=$(echo "scale=2; $size / 1048576" | bc)
        echo "  ✓ Created: ${size_mb} MB"
    else
        echo "  ✗ Failed to create OSIS file"
    fi
done

echo ""
echo "Conversion complete!"
