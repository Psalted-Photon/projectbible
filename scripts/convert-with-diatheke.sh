#!/bin/bash
# Convert Sword modules to OSIS using diatheke text dumping

MODULES="Wesley Clarke TSK Barnes Catena Lightfoot Luther CalvinCommentaries Family Abbott TFG RWP KingComments QuotingPassages NETnotesfree Personal"

RAW_DIR="/mnt/c/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/raw"
OSIS_DIR="/mnt/c/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/osis"

mkdir -p "$OSIS_DIR"

echo "Installing modules to SWORD..."
sudo mkdir -p /usr/share/sword/mods.d
sudo mkdir -p /usr/share/sword/modules

for moddir in wesley clarke tsk barnes catena lightfoot luther calvincommentaries family abbott tfg rwp kingcomments quotingpassages netnotesfree personal; do
    if [ -d "$RAW_DIR/$moddir/mods.d" ]; then
        sudo cp -r "$RAW_DIR/$moddir/mods.d"/* /usr/share/sword/mods.d/ 2>/dev/null
    fi
    if [ -d "$RAW_DIR/$moddir/modules" ]; then
        sudo cp -r "$RAW_DIR/$moddir/modules"/* /usr/share/sword/modules/ 2>/dev/null
    fi
done

echo ""
echo "Available modules:"
diatheke -b system

echo ""
echo "Converting modules using diatheke..."

BOOKS="Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev"

for module in $MODULES; do
    echo "[$module] Extracting commentary..."
    output_file="$OSIS_DIR/${module,,}.osis.xml"
    
    # Start OSIS XML
    cat > "$output_file" << 'HEADER'
<?xml version="1.0" encoding="UTF-8"?>
<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">
  <osisText osisIDWork="MODULE_ID" osisRefWork="Bible">
    <header>
      <work osisWork="MODULE_ID">
        <title>MODULE_ID Commentary</title>
        <creator role="author">MODULE_ID</creator>
      </work>
    </header>
    <div type="commentary">
HEADER
    
    sed -i "s/MODULE_ID/$module/g" "$output_file"
    
    entry_count=0
    
    for book in $BOOKS; do
        # Get commentary for entire book
        commentary=$(diatheke -b "$module" -k "$book" 2>/dev/null || true)
        
        if [ -n "$commentary" ] && [ "$commentary" != "No Entry for $book." ]; then
            # Parse output and create OSIS entries
            # This is simplified - real parsing would need verse-by-verse extraction
            echo "  ✓ Found commentary for $book"
            echo "      <div type=\"entry\" osisID=\"$book\">" >> "$output_file"
            echo "        <p>$(echo "$commentary" | sed 's/[&<>]/\\&/g' | head -c 5000)</p>" >> "$output_file"
            echo "      </div>" >> "$output_file"
            ((entry_count++))
        fi
    done
    
    # Close OSIS XML
    cat >> "$output_file" << 'FOOTER'
    </div>
  </osisText>
</osis>
FOOTER
    
    size=$(stat -c%s "$output_file")
    echo "  ✓ Created OSIS ($(numfmt --to=iec-i --suffix=B $size)), $entry_count entries"
done

echo ""
echo "✅ Conversion complete"
