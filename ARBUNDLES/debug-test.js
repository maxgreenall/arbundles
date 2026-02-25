// Debug test script for comparing ECDSA DataItem creation
// Run with: node debug-test.js

const { createData, EthereumSigner } = require('./build/node/cjs/index.js');

async function testECDSASigningDebug() {
    try {
        console.log("========== JAVASCRIPT ECDSA SIGNING DEBUG TEST ==========");
        
        // Create test signer with same private key for consistency
        const testPrivateKey = "8da4ef21b864d2cc526dbdb2a120bd2874c36c9d0a1fb7f8c63d7f7a8b41de8f";
        const signer = new EthereumSigner(testPrivateKey);
        
        console.log("Test signer public key:", signer.publicKey.toString('hex'));
        
        // Create simple test data (matching Swift test)
        const testData = "Hello AO!";
        const testTags = [
            { name: "Action", value: "Test" },
            { name: "Type", value: "Message" }
        ];
        
        // Create the data item
        console.log("Creating data item...");
        const dataItem = createData(testData, signer, { tags: testTags });
        
        // Sign the data item (this will trigger our debug prints)
        console.log("Signing data item...");
        await dataItem.sign(signer);
        
        console.log("Signed data item size:", dataItem.getRaw().length, "bytes");
        console.log("Data item ID:", dataItem.id);
        console.log("=======================================================");
        
    } catch (error) {
        console.error("Error in JavaScript ECDSA signing test:", error);
    }
}

// Run the test
testECDSASigningDebug(); 