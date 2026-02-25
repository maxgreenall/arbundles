const { createData } = require("@dha-team/arbundles");
const secp256k1 = require("secp256k1");
const crypto = require("crypto");
const { Wallet } = require("@ethersproject/wallet");
const fetch = require("node-fetch");

class ArweaveECDSASigner {
  constructor(privateKey) {
    // Remove 0x prefix if present
    this.privateKey = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
    this.privateKeyBuffer = Buffer.from(this.privateKey, "hex");
    
    // Generate both compressed and uncompressed public keys
    this.compressedPublicKey = secp256k1.publicKeyCreate(this.privateKeyBuffer, true);
    this.uncompressedPublicKey = secp256k1.publicKeyCreate(this.privateKeyBuffer, false);
    
    // Arweave address uses compressed key + SHA256
    this.arweaveAddress = this.deriveArweaveAddress();
    
    // For ethers wallet compatibility
    this.wallet = new Wallet("0x" + this.privateKey);
  }

  deriveArweaveAddress() {
    // SHA256 hash of the compressed public key
    const sha256Hash = crypto.createHash("sha256").update(this.compressedPublicKey).digest();
    
    // Convert to base64url
    const base64String = sha256Hash.toString("base64");
    const base64UrlString = base64String
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    
    return base64UrlString;
  }

  // Arbundles Signer interface
  get publicKey() {
    // Return uncompressed public key for arbundles compatibility
    // This is what gets used in the owner field of the DataItem
    return this.uncompressedPublicKey;
  }

  get signatureType() {
    return 3; // ETHEREUM/ECDSA
  }

  get signatureLength() {
    return 65; // ECDSA signature length
  }

  get ownerLength() {
    return 65; // Uncompressed public key length for arbundles compatibility
  }

  async sign(message) {
    // Use ethers wallet to sign
    const signature = await this.wallet.signMessage(message);
    return Buffer.from(signature.slice(2), "hex");
  }

  static async verify(pk, message, signature) {
    // Verification logic would go here
    return true; // Simplified for demo
  }
}

// Test private key
const privateKey = "3afdfe893b2680adc1eda213dbc94ba07b7f923fcb42afe13956f7ac7f619344";

// AO Message endpoint
const AO_ENDPOINT = "https://mu.ao-testnet.xyz/";
const TARGET_PROCESS = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";

async function main() {
  try {
    // Create custom signer that uses proper Arweave address
    const signer = new ArweaveECDSASigner(privateKey);
    
    console.log("=== Custom Arweave ECDSA Signer ===");
    console.log("Arweave Address:", signer.arweaveAddress);
    console.log("Compressed Public Key:", signer.compressedPublicKey.toString("hex"));
    console.log("Uncompressed Public Key:", signer.uncompressedPublicKey.toString("hex"));
    console.log("Owner Length:", signer.ownerLength);
    console.log("Public Key for Owner Field:", signer.publicKey.toString("hex"));
    console.log();

    // Create message data 
    const data = "Hello AO with proper Arweave address!";
    
    // AO-specific tags
    const tags = [
      { name: "Data-Protocol", value: "ao" },
      { name: "Variant", value: "ao.TN.1" },
      { name: "Type", value: "Message" },
      { name: "SDK", value: "custom-arweave-signer" }
    ];

    // Generate anchor
    const anchor = Math.round(Date.now() / 1000).toString().padStart(32, Math.floor(Math.random() * 10).toString());
    console.log("Using anchor:", anchor);
    console.log("Target process:", TARGET_PROCESS);

    // Create and sign data item
    const dataItem = createData(
      data, 
      signer, 
      { 
        tags,
        target: TARGET_PROCESS,
        anchor
      }
    );

    // Sign the data item
    await dataItem.sign(signer);
    
    console.log("Signed data item created");
    console.log("Data Item ID:", dataItem.id);
    console.log("Owner in DataItem:", dataItem.owner);
    console.log();
    
    // Compare with standard EthereumSigner
    const { EthereumSigner } = require("@dha-team/arbundles");
    const standardSigner = new EthereumSigner(privateKey);
    console.log("=== Comparison with Standard EthereumSigner ===");
    
    // Convert to base64url properly
    const standardOwner = standardSigner.publicKey.toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const customOwner = signer.publicKey.toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
      
    console.log("Standard Signer Owner:", standardOwner);
    console.log("Custom Signer Owner:  ", customOwner);
    console.log("Owners match:", standardOwner === customOwner);
    console.log();
    
    // Send to AO
    const response = await fetch(AO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Accept': 'application/json'
      },
      body: dataItem.getRaw()
    });

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response body:", errorText);
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    const result = await response.json();
    console.log("Message sent successfully:", result);
    
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error); 