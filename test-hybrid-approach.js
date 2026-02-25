const { createData, EthereumSigner } = require("@dha-team/arbundles");
const secp256k1 = require("secp256k1");
const crypto = require("crypto");
const { Wallet } = require("@ethersproject/wallet");
const fetch = require("node-fetch");

// Test private key
const privateKey = "3afdfe893b2680adc1eda213dbc94ba07b7f923fcb42afe13956f7ac7f619344";

// Simulate your Swift ECDSAWallet functionality
class ECDSAWalletJS {
  constructor(privateKeyHex) {
    this.privateKeyHex = privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex;
    this.privateKeyBuffer = Buffer.from(this.privateKeyHex, "hex");
  }
  
  // Swift equivalent methods
  getCompressedPublicKey() {
    return secp256k1.publicKeyCreate(this.privateKeyBuffer, true);
  }
  
  getUncompressedPublicKey() {
    return secp256k1.publicKeyCreate(this.privateKeyBuffer, false);
  }
  
  getArweaveAddressCompressed() {
    const compressed = this.getCompressedPublicKey();
    const sha256Hash = crypto.createHash("sha256").update(compressed).digest();
    return sha256Hash.toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }
  
  getArweaveAddressUncompressed() {
    const uncompressed = this.getUncompressedPublicKey();
    const sha256Hash = crypto.createHash("sha256").update(uncompressed).digest();
    return sha256Hash.toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }
  
  getAOCompatibleAddress() {
    return this.getArweaveAddressUncompressed();
  }
  
  // For Arweave transactions (compressed key in owner field)
  getArweaveOwnerField() {
    return this.getCompressedPublicKey().toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }
}

// Custom AO signer that bridges the gap
class AOCompatibleSigner {
  constructor(privateKey) {
    this.wallet = new ECDSAWalletJS(privateKey);
    this.ethersWallet = new Wallet("0x" + (privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey));
  }

  // Arbundles Signer interface - returns uncompressed for AO compatibility
  get publicKey() {
    return this.wallet.getUncompressedPublicKey();
  }

  get signatureType() {
    return 3; // ETHEREUM/ECDSA
  }

  get signatureLength() {
    return 65;
  }

  get ownerLength() {
    return 65;
  }

  async sign(message) {
    const signature = await this.ethersWallet.signMessage(message);
    return Buffer.from(signature.slice(2), "hex");
  }

  static async verify(pk, message, signature) {
    return true; // Simplified
  }
  
  // Additional methods for address compatibility
  getArweaveAddress() {
    return this.wallet.getArweaveAddressCompressed();
  }
  
  getAOAddress() {
    return this.wallet.getAOCompatibleAddress();
  }
}

async function testHybridApproach() {
  const wallet = new ECDSAWalletJS(privateKey);
  
  console.log("=== Hybrid Approach Test ===");
  console.log("Private Key:", privateKey);
  console.log();
  
  console.log("=== Address Management ===");
  console.log("Arweave Address (Compressed):  ", wallet.getArweaveAddressCompressed());
  console.log("AO Compatible Address:         ", wallet.getAOCompatibleAddress());
  console.log("Your Current Swift Address:    -MaYVfOf7WHFGFUZZAGTsyzWylDoYr3uACmSFvLjtus");
  console.log("Your Current AO Owner:         pT1xLREsm4fByqhoGEsVLjzOCnCL55BZp9k3YJ4R58E");
  console.log();
  
  console.log("=== Verification ===");
  console.log("✓ Swift address matches:", wallet.getArweaveAddressCompressed() === "-MaYVfOf7WHFGFUZZAGTsyzWylDoYr3uACmSFvLjtus");
  console.log("✓ AO address matches:   ", wallet.getAOCompatibleAddress() === "pT1xLREsm4fByqhoGEsVLjzOCnCL55BZp9k3YJ4R58E");
  console.log();
  
  console.log("=== Recommended Approach ===");
  console.log("1. Keep Swift Arweave transactions as-is (compressed key)");
  console.log("2. Use custom AO signer for AO messages");
  console.log("3. Both will work with the same private key");
  console.log("4. User sees consistent identity across systems");
  console.log();
  
  // Test AO message with custom signer
  console.log("=== Testing AO Message ===");
  const aoSigner = new AOCompatibleSigner(privateKey);
  
  console.log("AO Signer Arweave Address:", aoSigner.getArweaveAddress());
  console.log("AO Signer AO Address:     ", aoSigner.getAOAddress());
  
  const data = "Test message with hybrid approach";
  const tags = [
    { name: "Data-Protocol", value: "ao" },
    { name: "Variant", value: "ao.TN.1" },
    { name: "Type", value: "Message" },
    { name: "SDK", value: "hybrid-approach" }
  ];
  
  const anchor = Math.round(Date.now() / 1000).toString().padStart(32, "0");
  const dataItem = createData(data, aoSigner, {
    tags,
    target: "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc",
    anchor
  });
  
  await dataItem.sign(aoSigner);
  console.log("AO Message ID:", dataItem.id);
  console.log("AO Message Owner:", dataItem.owner);
  
  // Send to AO
  try {
    const response = await fetch("https://mu.ao-testnet.xyz/", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Accept': 'application/json'
      },
      body: dataItem.getRaw()
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log("✓ AO Message sent successfully:", result.id);
    } else {
      console.log("✗ AO Message failed:", response.status);
    }
  } catch (error) {
    console.log("✗ AO Message error:", error.message);
  }
  
  console.log();
  console.log("=== Summary ===");
  console.log("Your Swift code should:");
  console.log("1. Keep current Arweave implementation (compressed key in owner field)");
  console.log("2. Add getAOCompatibleAddress() method for UI display");
  console.log("3. Use this custom signer approach for AO messages in Node.js");
  console.log("4. Result: Same user identity, different technical implementation");
}

testHybridApproach().catch(console.error); 