#!/usr/bin/env node

const Arweave = require('arweave');

// Hardcoded private key (same as AO script)
const privateKey = "3afdfe893b2680adc1eda213dbc94ba07b7f923fcb42afe13956f7ac7f619344";

async function createArweaveTransaction(ethPrivateKey, transactionData = {}) {
    try {
        const arweave = Arweave.init({
            host: 'arweave.net',
            port: 443,
            protocol: 'https'
        });

        let cleanPrivateKey = ethPrivateKey.replace(/^0x/, '');

        if (cleanPrivateKey.length !== 64) {
            throw new Error('Invalid private key length. Expected 32 bytes (64 hex characters)');
        }

        const privateKeyBytes = new Uint8Array(
            cleanPrivateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );

        const secp256k1 = require('@arweave/wasm-secp256k1');
        const driver = await secp256k1.initWasmSecp256k1();
        const uncompressedPublicKey = driver.sk_to_pk(privateKeyBytes, true);
        console.log('🔍 Public key length:', uncompressedPublicKey.length, 'bytes');
        console.log('🔍 Public key prefix:', uncompressedPublicKey[0].toString(16).padStart(2, '0'));
        
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(uncompressedPublicKey).digest();
        const address = Buffer.from(hash).toString('base64url');

        console.log('📍 Creating transaction from address:', address);

        // Set up transaction data
        const txData = {
            data: transactionData.data || Buffer.from('Hello from Ethereum!', 'utf8'),
            target: transactionData.target || '',
            quantity: transactionData.quantity || '0',
        };

        console.log('💾 Data size:', typeof txData.data === 'string' ? txData.data.length : txData.data.byteLength, 'bytes');

        // Get last transaction anchor
        const lastTx = await arweave.transactions.getTransactionAnchor();

        // Prepare data
        let dataBuffer;
        if (typeof txData.data === 'string') {
            dataBuffer = Buffer.from(txData.data, 'utf8');
        } else {
            dataBuffer = new Uint8Array(txData.data);
        }

        // Get price for transaction
        const reward = await arweave.transactions.getPrice(dataBuffer.byteLength, txData.target);

        // Create transaction object
        const transaction = await arweave.createTransaction({
            data: dataBuffer,
            target: txData.target,
            quantity: txData.quantity,
            reward: reward
        });

        // Add tags
        const defaultTags = [
            { name: 'Content-Type', value: 'text/plain' },
            { name: 'Creator', value: 'ethereum-signer' },
            { name: 'Source-Network', value: 'Ethereum' },
            { name: 'Key-Type', value: 'secp256k1' }
        ];

        const tagsToAdd = transactionData.tags || defaultTags;
        tagsToAdd.forEach(tag => {
            transaction.addTag(tag.name, tag.value);
        });

        console.log('🏷️  Transaction created with', transaction.tags.length, 'tags');
        console.log('💰 Reward:', arweave.ar.winstonToAr(transaction.reward), 'AR');

        // Sign the transaction using secp256k1
        const signatureData = await transaction.getSignatureData();
        const signature = await driver.sign(privateKeyBytes, signatureData);
        
        // Set the signature
        transaction.setSignature({
            id: arweave.utils.bufferTob64Url(crypto.createHash('sha256').update(signature).digest()),
            owner: '', // Empty for secp256k1
            signature: arweave.utils.bufferTob64Url(signature)
        });

        console.log('✅ Transaction signed successfully!');
        console.log('🆔 Transaction ID:', transaction.id);

        // Try to verify the transaction
        let isValid = false;
        try {
            isValid = await arweave.transactions.verify(transaction);
            console.log('🔍 Transaction verification:', isValid ? '✅ VALID' : '❌ INVALID');
        } catch (error) {
            console.log('🔍 Transaction verification error:', error.message);
        }

        return {
            transaction,
            address,
            isValid,
            metadata: {
                id: transaction.id,
                owner: transaction.owner,
                target: transaction.target,
                quantity: transaction.quantity,
                reward: transaction.reward,
                dataSize: transaction.data_size,
                tags: transaction.tags.map(tag => ({
                    name: tag.get('name', { decode: true, string: true }),
                    value: tag.get('value', { decode: true, string: true })
                })),
                signatureLength: signature.length
            }
        };

    } catch (error) {
        throw new Error(`Failed to create Arweave transaction: ${error.message}`);
    }
}

async function postTransaction(transaction) {
    const arweave = Arweave.init({
        host: 'arweave.net',
        port: 443,
        protocol: 'https'
    });

    try {
        console.log('📡 Posting transaction to Arweave network...');

        const response = await arweave.transactions.post(transaction);

        console.log('📋 Network response status:', response.status);
        console.log('📋 Network response:', response.statusText);

        if (response.status === 200) {
            console.log('🎉 Transaction posted successfully!');
            console.log('🔗 View on ArScan:', `https://arscan.io/tx/${transaction.id}`);
            console.log('🔗 View data:', `https://arweave.net/${transaction.id}`);
        } else {
            console.log('⚠️  Transaction post failed with status:', response.status);
            if (response.status === 400) {
                console.log('💡 Transaction format or signature issue');
            } else if (response.status === 402) {
                console.log('💡 Insufficient AR balance for fees');
            }
        }

        return {
            success: response.status === 200,
            status: response.status,
            statusText: response.statusText,
            transactionId: transaction.id
        };

    } catch (error) {
        throw new Error(`Failed to post transaction: ${error.message}`);
    }
}

// Main execution
async function main() {
    try {
        console.log('🔑 Using hardcoded Ethereum private key for Arweave transaction...\n');

        const result = await createArweaveTransaction(privateKey, {
            data: 'Hello from Ethereum! This transaction was signed with the same private key as the AO transaction.',
            target: '', // No target for data-only transaction
            quantity: '0' // No AR transfer
        });

        console.log('\n📄 Transaction Summary:');
        console.log('='.repeat(50));
        console.log('Transaction ID:', result.metadata.id);
        console.log('From Address:', result.address);
        console.log('Data Size:', result.metadata.dataSize, 'bytes');
        console.log('Reward:', Arweave.init().ar.winstonToAr(result.metadata.reward), 'AR');
        console.log('Tags:', result.metadata.tags.length);
        console.log('Signature Length:', result.metadata.signatureLength, 'bytes');
        console.log('Owner (empty for secp256k1):', result.metadata.owner === '' ? '✅ Empty' : '❌ Not empty');
        console.log('Verification Status:', result.isValid ? '✅ VALID' : '❌ INVALID');

        console.log('\n📡 Automatically posting to Arweave network...');
        const postResult = await postTransaction(result.transaction);

        if (postResult.success) {
            console.log('\n🎉 SUCCESS! Transaction posted to Arweave network!');
            console.log('🔗 View on ArScan:', `https://arscan.io/tx/${result.metadata.id}`);
            console.log('🔗 View data:', `https://arweave.net/${result.metadata.id}`);
        } else {
            console.log('\n❌ Failed to post transaction');
            console.log('Status:', postResult.status);
            console.log('Response:', postResult.statusText);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Export functions for use as module
module.exports = {
    createArweaveTransaction,
    postTransaction
};

// Run main if this file is executed directly
if (require.main === module) {
    main();
}
