const { EthereumSigner } = require("@dha-team/arbundles");
const secp256k1 = require("secp256k1");
const crypto = require("crypto");
const { keccak256 } = require("@ethersproject/keccak256");

// Test private key
const privateKey = "3afdfe893b2680adc1eda213dbc94ba07b7f923fcb42afe13956f7ac7f619344";

function deriveArweaveAddressCompressed(privateKeyHex) {
  const cleanKey = privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBuffer = Buffer.from(cleanKey, "hex");
  
  // Get compressed public key (33 bytes: 0x02/0x03 + 32 bytes x)
  const compressedPublicKey = secp256k1.publicKeyCreate(privateKeyBuffer, true);
  
  // SHA256 hash of the compressed public key
  const sha256Hash = crypto.createHash("sha256").update(compressedPublicKey).digest();
  
  // Convert to base64url
  const base64String = sha256Hash.toString("base64");
  const base64UrlString = base64String
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  return base64UrlString;
}

function deriveArweaveAddressUncompressed(privateKeyHex) {
  const cleanKey = privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBuffer = Buffer.from(cleanKey, "hex");
  
  // Get uncompressed public key (65 bytes: 0x04 + 32 bytes x + 32 bytes y)
  const uncompressedPublicKey = secp256k1.publicKeyCreate(privateKeyBuffer, false);
  
  // SHA256 hash of the uncompressed public key
  const sha256Hash = crypto.createHash("sha256").update(uncompressedPublicKey).digest();
  
  // Convert to base64url
  const base64String = sha256Hash.toString("base64");
  const base64UrlString = base64String
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  return base64UrlString;
}

function getArbundlesOwner(privateKeyHex) {
  const cleanKey = privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBuffer = Buffer.from(cleanKey, "hex");
  
  // Get uncompressed public key (65 bytes: 0x04 + 32 bytes x + 32 bytes y)
  const uncompressedPublicKey = secp256k1.publicKeyCreate(privateKeyBuffer, false);
  
  // Convert to base64url (this is what gets used as the owner field)
  const base64String = uncompressedPublicKey.toString("base64");
  const base64UrlString = base64String
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  return base64UrlString;
}

console.log("=== Address Compatibility Test ===");
console.log("Private Key:", privateKey);
console.log();

// Calculate different address types
const arweaveCompressed = deriveArweaveAddressCompressed(privateKey);
const arweaveUncompressed = deriveArweaveAddressUncompressed(privateKey);
const arbundlesOwner = getArbundlesOwner(privateKey);

console.log("=== Address Derivation Methods ===");
console.log("1. Arweave (Compressed):     ", arweaveCompressed);
console.log("2. Arweave (Uncompressed):   ", arweaveUncompressed);
console.log("3. Arbundles Owner:          ", arbundlesOwner);
console.log();

console.log("=== Your Current Addresses ===");
console.log("Swift Arweave (Compressed):  -MaYVfOf7WHFGFUZZAGTsyzWylDoYr3uACmSFvLjtus");
console.log("AO Message Owner:            pT1xLREsm4fByqhoGEsVLjzOCnCL55BZp9k3YJ4R58E");
console.log();

console.log("=== Compatibility Analysis ===");
console.log("Current Swift → AO:          Different addresses (compressed vs uncompressed owner)");
console.log("Modified Swift → AO:         Same owner field (both use uncompressed key)");
console.log();

console.log("=== Recommendation ===");
console.log("Option 1: Modify Swift to use uncompressed key for Arweave address");
console.log("  - Arweave address becomes:  ", arweaveUncompressed);
console.log("  - AO messages use same owner:", arbundlesOwner);
console.log("  - Result: Same identity across both systems");
console.log();

console.log("Option 2: Keep current Swift, create custom AO signer");
console.log("  - Keep Arweave address:      -MaYVfOf7WHFGFUZZAGTsyzWylDoYr3uACmSFvLjtus");
console.log("  - Custom signer derives this from compressed key");
console.log("  - Result: Different technical implementation, same user experience");
console.log();

// Show public key formats
const cleanKey = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
const privateKeyBuffer = Buffer.from(cleanKey, "hex");
const uncompressed = secp256k1.publicKeyCreate(privateKeyBuffer, false);
const compressed = secp256k1.publicKeyCreate(privateKeyBuffer, true);

console.log("=== Public Key Details ===");
console.log("Compressed (33 bytes):       ", compressed.toString("hex"));
console.log("Uncompressed (65 bytes):     ", uncompressed.toString("hex"));
console.log("Uncompressed starts with:    ", uncompressed[0] === 0x04 ? "0x04 ✓" : "❌");
console.log(); 