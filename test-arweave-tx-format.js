const secp256k1 = require("secp256k1");
const crypto = require("crypto");

// Test private key
const privateKey = "3afdfe893b2680adc1eda213dbc94ba07b7f923fcb42afe13956f7ac7f619344";

function analyzeArweaveFormat() {
  const cleanKey = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  const privateKeyBuffer = Buffer.from(cleanKey, "hex");
  
  // Generate both key formats
  const compressed = secp256k1.publicKeyCreate(privateKeyBuffer, true);
  const uncompressed = secp256k1.publicKeyCreate(privateKeyBuffer, false);
  
  console.log("=== Arweave Transaction Format Analysis ===");
  console.log();
  
  console.log("=== Public Key Formats ===");
  console.log("Compressed (33 bytes):   ", compressed.toString("base64"));
  console.log("Uncompressed (65 bytes): ", uncompressed.toString("base64"));
  console.log();
  
  // Convert to base64url for Arweave
  const compressedB64url = compressed.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
    
  const uncompressedB64url = uncompressed.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  console.log("=== Base64URL Encoded (for Arweave owner field) ===");
  console.log("Compressed:   ", compressedB64url);
  console.log("Uncompressed: ", uncompressedB64url);
  console.log();
  
  // Calculate addresses
  const compressedAddress = crypto.createHash("sha256").update(compressed).digest().toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
    
  const uncompressedAddress = crypto.createHash("sha256").update(uncompressed).digest().toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  console.log("=== Derived Addresses ===");
  console.log("From compressed:   ", compressedAddress);
  console.log("From uncompressed: ", uncompressedAddress);
  console.log("Your current:      -MaYVfOf7WHFGFUZZAGTsyzWylDoYr3uACmSFvLjtus");
  console.log("Your AO owner:     pT1xLREsm4fByqhoGEsVLjzOCnCL55BZp9k3YJ4R58E");
  console.log();
  
  console.log("=== Analysis ===");
  console.log("✓ Compressed address matches your Swift:", compressedAddress === "-MaYVfOf7WHFGFUZZAGTsyzWylDoYr3uACmSFvLjtus");
  console.log("✓ Uncompressed address matches AO:     ", uncompressedAddress === "pT1xLREsm4fByqhoGEsVLjzOCnCL55BZp9k3YJ4R58E");
  console.log();
  
  console.log("=== Recommendations ===");
  console.log("1. For Arweave compatibility: Use compressed public key in owner field");
  console.log("2. For AO compatibility: Use uncompressed public key");
  console.log("3. The issue might be:");
  console.log("   - Arweave expects compressed key in owner field");
  console.log("   - You're sending uncompressed key");
  console.log("   - This causes signature verification to fail");
  console.log();
  
  console.log("=== Suggested Fix ===");
  console.log("In your Swift code, for Arweave transactions:");
  console.log("- Keep using compressed public key in owner field");
  console.log("- But change address derivation to match your preference");
  console.log("- Or create separate methods for Arweave vs AO");
}

analyzeArweaveFormat(); 