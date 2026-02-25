const { EthereumSigner } = require("@dha-team/arbundles");
const secp256k1 = require("secp256k1");
const crypto = require("crypto");
const { keccak256 } = require("@ethersproject/keccak256");

// Test private key
const privateKey = "3afdfe893b2680adc1eda213dbc94ba07b7f923fcb42afe13956f7ac7f619344";

function deriveEthereumAddress(privateKeyHex) {
  // Remove 0x prefix if present
  const cleanKey = privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBuffer = Buffer.from(cleanKey, "hex");
  
  // Get uncompressed public key (65 bytes: 0x04 + 32 bytes x + 32 bytes y)
  const uncompressedPublicKey = secp256k1.publicKeyCreate(privateKeyBuffer, false);
  
  // Remove the 0x04 prefix, keep only the 64 bytes (x + y coordinates)
  const publicKeyWithoutPrefix = uncompressedPublicKey.slice(1);
  
  // Keccak256 hash of the public key
  const hash = keccak256(publicKeyWithoutPrefix);
  
  // Take last 20 bytes and add 0x prefix
  const address = "0x" + hash.slice(-40);
  
  return address;
}

function deriveArweaveAddress(privateKeyHex) {
  // Remove 0x prefix if present
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

function getArbundlesOwner(privateKeyHex) {
  // This is what arbundles EthereumSigner does
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

console.log("Private Key:", privateKey);
console.log();

// Using EthereumSigner from arbundles
const signer = new EthereumSigner(privateKey);
console.log("=== Arbundles EthereumSigner ===");
console.log("Public Key (hex):", signer.publicKey.toString("hex"));
console.log("Public Key Length:", signer.publicKey.length, "bytes");
console.log("Owner (base64url):", signer.publicKey.toString("base64url"));
console.log();

// Manual derivations
console.log("=== Address Comparisons ===");
const ethAddress = deriveEthereumAddress(privateKey);
const arweaveAddress = deriveArweaveAddress(privateKey);
const arbundlesOwner = getArbundlesOwner(privateKey);

console.log("Ethereum Address:           ", ethAddress);
console.log("Arweave Address (Swift):    ", arweaveAddress);
console.log("Arbundles Owner (AO):       ", arbundlesOwner);
console.log();

// Your actual addresses
console.log("=== Your Actual Addresses ===");
console.log("Swift Arweave Address:      -MaYVfOf7WHFGFUZZAGTsyzWylDoYr3uACmSFvLjtus");
console.log("AO Message Owner:           pT1xLREsm4fByqhoGEsVLjzOCnCL55BZp9k3YJ4R58E");
console.log("Calculated Arbundles Owner: ", arbundlesOwner);
console.log();

// Show the difference in public key formats
const cleanKey = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
const privateKeyBuffer = Buffer.from(cleanKey, "hex");
const uncompressed = secp256k1.publicKeyCreate(privateKeyBuffer, false);
const compressed = secp256k1.publicKeyCreate(privateKeyBuffer, true);

console.log("=== Public Key Formats ===");
console.log("Uncompressed (65 bytes):", uncompressed.toString("hex"));
console.log("Compressed (33 bytes):  ", compressed.toString("hex"));
console.log();
console.log("The difference:");
console.log("- Swift/Arweave: compressed public key + sha256 + base64url");
console.log("- Arbundles/AO:  uncompressed public key + base64url (no hash)");
console.log("- Ethereum:      uncompressed public key + keccak256 + last 20 bytes"); 