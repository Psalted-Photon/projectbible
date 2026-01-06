import { readFileSync } from 'fs';
import Ajv from 'ajv';
import { SourceManifest } from '../types.js';

const ajv = new Ajv();

export async function validateManifest(manifestPath: string): Promise<void> {
  console.log(`Validating manifest: ${manifestPath}`);
  
  try {
    // Read the manifest
    const manifestContent = readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent) as SourceManifest;
    
    // Read the schema
    const schemaPath = '../../data-manifests/schemas/source-manifest.schema.json';
    const schemaContent = readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);
    
    // Validate
    const validate = ajv.compile(schema);
    const valid = validate(manifest);
    
    if (!valid) {
      console.error('❌ Validation failed:');
      console.error(validate.errors);
      process.exit(1);
    }
    
    console.log('✅ Manifest is valid');
    console.log(`   Pack ID: ${manifest.id}`);
    console.log(`   Version: ${manifest.version}`);
    console.log(`   Type: ${manifest.type}`);
    console.log(`   License: ${manifest.license}`);
    
  } catch (error) {
    console.error('❌ Error validating manifest:', error);
    process.exit(1);
  }
}
