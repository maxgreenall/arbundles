const { EthereumSigner, createData } = require("@dha-team/arbundles");
const fetch = require("node-fetch");

const privateKey = "3afdfe893b2680adc1eda213dbc94ba07b7f923fcb42afe13956f7ac7f619344";

const AO_ENDPOINT = "https://mu.ao-testnet.xyz/";

const TARGET_PROCESS = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";

async function main() {
  try {
    console.log("========== JAVASCRIPT ECDSA SIGNING DEBUG TEST ==========");
    
    const signer = new EthereumSigner(privateKey);
    console.log("Signer public key:", signer.publicKey.toString('hex'));
    console.log("Signer public key length:", signer.publicKey.length);

    const data = "Hello AO from Node.js!";
    console.log("Message data:", data);
    console.log("Message data hex:", Buffer.from(data, 'utf8').toString('hex'));
    
    const tags = [
      { name: "Data-Protocol", value: "ao" },
      { name: "Variant", value: "ao.TN.1" },
      { name: "Type", value: "Message" },
      { name: "SDK", value: "arbundles-node" },
      { name: "Action", value: "ETH Signer" }
    ];

    console.log("Tags:", tags);

    const anchor = Math.round(Date.now() / 1000).toString().padStart(32, Math.floor(Math.random() * 10).toString());
    console.log("Using anchor:", anchor);
    console.log("Target process:", TARGET_PROCESS);

    console.log("Creating data item...");
    const dataItem = createData(
      data, 
      signer, 
      { 
        tags,
        target: TARGET_PROCESS, 
        anchor
      }
    );

    console.log("Data item created, now signing...");
    console.log("Pre-sign data item signature type:", dataItem.signatureType);
    console.log("Pre-sign data item owner length:", dataItem.rawOwner.length);
    console.log("Pre-sign data item owner hex:", Buffer.from(dataItem.rawOwner).toString('hex'));

    await dataItem.sign(signer);
    
    console.log("=== POST-SIGNING RESULTS ===");
    console.log("Signed data item created");
    console.log("Data Item ID:", dataItem.id);
    console.log("Data item size:", dataItem.getRaw().length, "bytes");
    console.log("Final signature hex:", dataItem.signature);
    console.log("Final signature length:", Buffer.from(dataItem.rawSignature).length);
    console.log("============================");
    
    console.log("Sending to AO...");
    const response = await fetch(AO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Accept': 'application/json'
      },
      body: dataItem.getRaw()
    });

    console.log("Response status:", response.status);
    console.log("Response headers:", Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response body:", errorText);
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    const result = await response.json();
    console.log("Message sent successfully:", result);
    console.log("=======================================================");
    
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error); 