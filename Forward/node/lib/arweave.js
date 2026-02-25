const Transaction = require('./transaction').default;
const { SECP256k1PrivateKey } = require('./crypto/keys/secp256k1');

class Arweave {
    constructor(config = {}) {
        this.config = {
            host: config.host || 'arweave.net',
            port: config.port || 443,
            protocol: config.protocol || 'https',
            ...config
        };
        
        this.transactions = {
            getTransactionAnchor: async () => {
                // Mock implementation - in real usage this would fetch from network
                return 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
            },
            getPrice: async (size, target = '') => {
                // Mock price calculation
                return '1000000';
            },
            post: async (transaction) => {
                // Mock post implementation
                return { status: 200, statusText: 'OK' };
            },
            verify: async (transaction) => {
                // Mock verification
                return true;
            }
        };
        
        this.ar = {
            arToWinston: (ar) => {
                return (parseFloat(ar) * 1e12).toString();
            },
            winstonToAr: (winston) => {
                return (parseFloat(winston) / 1e12).toString();
            }
        };
        
        this.utils = {
            bufferTob64Url: (buffer) => {
                return Buffer.from(buffer).toString('base64url');
            }
        };
    }
    
    static init(config = {}) {
        return new Arweave(config);
    }
    
    async createTransaction(transactionData) {
        return new Transaction(transactionData);
    }
}

module.exports = { default: Arweave }; 