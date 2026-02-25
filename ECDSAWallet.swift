//
//  ECDSAWallet.swift
//  beacon
//
//  Created by Max Greenall on 5/30/25.
//

import P256K
import libsecp256k1
import SwiftKeccak
import Security
import CryptoKit
import Foundation
import Arweave

struct ECDSAWallet: Codable, Equatable, Hashable {
    var name: String
    let address: String
    let privateKeyHex: String

    init(name: String, privateKeyHex: String) throws {
        self.name = name
        self.privateKeyHex = privateKeyHex

        self.address = try Self.deriveArweaveAddress(from: privateKeyHex)
    }

    init(name: String, address: String, privateKeyHex: String) {
        self.name = name
        self.address = address
        self.privateKeyHex = privateKeyHex
    }

    // MARK: - Wallet Generation
    
    static func generateNew(name: String) throws -> ECDSAWallet {
        // Generate 32 random bytes for the private key
        var privateKeyBytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, 32, &privateKeyBytes)
        
        guard status == errSecSuccess else {
            throw NSError(domain: "ECDSAWallet", code: 10, userInfo: [NSLocalizedDescriptionKey: "Failed to generate random private key"])
        }
        
        let privateKeyHex = Data(privateKeyBytes).map { String(format: "%02x", $0) }.joined()
        
        return try ECDSAWallet(name: name, privateKeyHex: privateKeyHex)
    }

    // MARK: - Private Key Validation and Public Key Derivation

    private static func getPublicKey(from privateKeyHex: String, compressed: Bool = false) throws -> [UInt8] {
        guard let privateKeyData = Data(hex: privateKeyHex) else {
            throw NSError(domain: "ECDSAWallet", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid private key hex"])
        }

        guard privateKeyData.count == 32 else {
            throw NSError(domain: "ECDSAWallet", code: 2, userInfo: [NSLocalizedDescriptionKey: "Private key must be 32 bytes"])
        }

        guard let ctx = secp256k1_context_create(UInt32(SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY)) else {
            throw NSError(domain: "ECDSAWallet", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create secp256k1 context"])
        }
        defer { secp256k1_context_destroy(ctx) }

        var publicKey = secp256k1_pubkey()
        let privateKeyBytes = [UInt8](privateKeyData)
        guard secp256k1_ec_pubkey_create(ctx, &publicKey, privateKeyBytes) == 1 else {
            throw NSError(domain: "ECDSAWallet", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to create public key from private key"])
        }

        let keyLength = compressed ? 33 : 65
        let format = compressed ? UInt32(SECP256K1_EC_COMPRESSED) : UInt32(SECP256K1_EC_UNCOMPRESSED)

        var publicKeyData = [UInt8](repeating: 0, count: keyLength)
        var publicKeyLength = keyLength
        guard secp256k1_ec_pubkey_serialize(ctx, &publicKeyData, &publicKeyLength, &publicKey, format) == 1 else {
            throw NSError(domain: "ECDSAWallet", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to serialize public key"])
        }

        return publicKeyData
    }
    
    static func getPublicKeyBytes(from privateKeyHex: String, compressed: Bool = false) throws -> [UInt8] {
        return try getPublicKey(from: privateKeyHex, compressed: compressed)
    }

    // MARK: - Address Derivation

    private static func deriveEthereumAddress(from privateKeyHex: String) throws -> String {
        let uncompressedPublicKey = try getPublicKey(from: privateKeyHex, compressed: false)

        let publicKeyBytes = Array(uncompressedPublicKey[1...])

        let hashData = keccak256(Data(publicKeyBytes))

        let addressBytes = Array(hashData[12...])

        return "0x" + addressBytes.map { String(format: "%02x", $0) }.joined()
    }

    private static func deriveArweaveAddress(from privateKeyHex: String) throws -> String {
        let compressedPublicKey = try getPublicKey(from: privateKeyHex, compressed: true)

        let sha256Hash = SHA256.hash(data: Data(compressedPublicKey))

        let base64String = Data(sha256Hash).base64EncodedString()
        let base64UrlString = base64String
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        return base64UrlString
    }
    
    private static func deriveAOAddress(from privateKeyHex: String) throws -> String {
        let uncompressedPublicKey = try getPublicKey(from: privateKeyHex, compressed: false)

        let sha256Hash = SHA256.hash(data: Data(uncompressedPublicKey))

        let base64String = Data(sha256Hash).base64EncodedString()
        let base64UrlString = base64String
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        return base64UrlString
    }

    func getEthAddress() -> String {
        return (try? Self.deriveEthereumAddress(from: privateKeyHex)) ?? ""
    }

    func getArweaveAddress() -> String {
        return (try? Self.deriveArweaveAddress(from: privateKeyHex)) ?? ""
    }
    
    func getAOAddress() -> String {
        return (try? Self.deriveAOAddress(from: privateKeyHex)) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case address
        case privateKeyHex
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(address, forKey: .address)
        try container.encode(privateKeyHex, forKey: .privateKeyHex)
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        address = try container.decode(String.self, forKey: .address)
        privateKeyHex = try container.decode(String.self, forKey: .privateKeyHex)
    }

    static func < (lhs: ECDSAWallet, rhs: ECDSAWallet) -> Bool {
        return lhs.address < rhs.address
    }

    static func == (lhs: ECDSAWallet, rhs: ECDSAWallet) -> Bool {
        return lhs.name == rhs.name &&
               lhs.address == rhs.address &&
               lhs.privateKeyHex == rhs.privateKeyHex
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(name)
        hasher.combine(address)
        hasher.combine(privateKeyHex)
    }

    func secp256k1Sign(hash: Data) throws -> Data {
        guard let privateKeyData = Data(hex: privateKeyHex) else {
            throw NSError(domain: "ECDSAWallet", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid private key hex"])
        }
        guard let ctx = secp256k1_context_create(UInt32(SECP256K1_CONTEXT_SIGN)) else {
            throw NSError(domain: "ECDSAWallet", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to create secp256k1 context"])
        }
        defer { secp256k1_context_destroy(ctx) }

        var signature = secp256k1_ecdsa_recoverable_signature()
        let privateKeyBytes = [UInt8](privateKeyData)
        let messageHashBytes = [UInt8](hash)

        guard secp256k1_ecdsa_sign_recoverable(ctx, &signature, messageHashBytes, privateKeyBytes, nil, nil) == 1 else {
            throw NSError(domain: "ECDSAWallet", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create recoverable signature"])
        }

        var compactSignature = [UInt8](repeating: 0, count: 64)
        var recoveryId: Int32 = 0

        guard secp256k1_ecdsa_recoverable_signature_serialize_compact(ctx, &compactSignature, &recoveryId, &signature) == 1 else {
            throw NSError(domain: "ECDSAWallet", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to serialize recoverable signature"])
        }

        var recoverableSignature = compactSignature
        // Use Ethereum format recovery ID (add 27)
        recoverableSignature.append(UInt8(recoveryId + 27))

        return Data(recoverableSignature)
    }
    
    // Ethereum message signing (matches ethers.js wallet.signMessage)
    func ethereumSignMessage(_ message: Data) throws -> Data {
        // Create Ethereum message format: "\x19Ethereum Signed Message:\n" + length + message
        let prefix = "\u{19}Ethereum Signed Message:\n"
        let prefixData = prefix.data(using: .utf8)!
        let lengthString = "\(message.count)"
        let lengthData = lengthString.data(using: .utf8)!
        
        var ethereumMessage = Data()
        ethereumMessage.append(prefixData)
        ethereumMessage.append(lengthData)
        ethereumMessage.append(message)
        
        // Hash with keccak256
        let messageHash = keccak256(ethereumMessage)
        
        // Sign the hash
        return try secp256k1Sign(hash: messageHash)
    }

    // Raw ECDSA signing (for AO/KYVE - no Ethereum message prefix)
    func rawECDSASign(hash: Data) throws -> Data {
        guard let privateKeyData = Data(hex: privateKeyHex) else {
            throw NSError(domain: "ECDSAWallet", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid private key hex"])
        }
        guard let ctx = secp256k1_context_create(UInt32(SECP256K1_CONTEXT_SIGN)) else {
            throw NSError(domain: "ECDSAWallet", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to create secp256k1 context"])
        }
        defer { secp256k1_context_destroy(ctx) }

        var signature = secp256k1_ecdsa_recoverable_signature()
        let privateKeyBytes = [UInt8](privateKeyData)
        let messageHashBytes = [UInt8](hash)

        guard secp256k1_ecdsa_sign_recoverable(ctx, &signature, messageHashBytes, privateKeyBytes, nil, nil) == 1 else {
            throw NSError(domain: "ECDSAWallet", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create recoverable signature"])
        }

        var compactSignature = [UInt8](repeating: 0, count: 64)
        var recoveryId: Int32 = 0

        guard secp256k1_ecdsa_recoverable_signature_serialize_compact(ctx, &compactSignature, &recoveryId, &signature) == 1 else {
            throw NSError(domain: "ECDSAWallet", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to serialize recoverable signature"])
        }

        var recoverableSignature = compactSignature
        // For raw ECDSA (AO/KYVE), use raw recovery ID (0 or 1)
        recoverableSignature.append(UInt8(recoveryId))

        return Data(recoverableSignature)
    }
}

struct ECDSAArweaveTransaction: Encodable {
    var format: Int = 2
    var id: String = ""
    var last_tx: String = ""
    var owner: String = ""
    var tags: [Tag] = []
    var target: String
    var quantity: String
    var data: Data = Data()
    var data_size: String = "0"
    var data_root: String = ""
    var reward: String = ""
    var signature: String = ""

    struct Tag: Codable {
        let name: String
        let value: String

        enum CodingKeys: String, CodingKey {
            case name, value
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(name.data(using: .utf8)!.base64URLEncodedString(), forKey: .name)
            try container.encode(value.data(using: .utf8)!.base64URLEncodedString(), forKey: .value)
        }
    }
    
    enum CodingKeys: String, CodingKey {
        case format
        case id
        case last_tx
        case owner
        case tags
        case target
        case quantity
        case data
        case data_size
        case data_root
        case reward
        case signature
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(format, forKey: .format)
        try container.encode(id, forKey: .id)
        try container.encode(last_tx, forKey: .last_tx)
        try container.encode(owner, forKey: .owner)
        try container.encode(tags, forKey: .tags)
        try container.encode(target, forKey: .target)
        try container.encode(quantity, forKey: .quantity)
        try container.encode(data, forKey: .data)
        try container.encode(data_size, forKey: .data_size)
        try container.encode(data_root, forKey: .data_root)
        try container.encode(reward, forKey: .reward)
        try container.encode(signature, forKey: .signature)
    }

    init(target: String, amountAR: Double) {
        self.target = target
        self.quantity = String(format: "%.0f", amountAR * 1_000_000_000_000)

        self.tags = [
            Tag(name: "Content-Type", value: "text/plain"),
            Tag(name: "Key-Type", value: "secp256k1"),
            Tag(name: "SDK", value: "Beacon Wallet")
        ]
    }

    mutating func sign(with wallet: ECDSAWallet) async throws {
        let pr = Transaction.PriceRequest(bytes: 0, target: Address(address: target))
        let priceAmount = try await Transaction.price(for: pr)
        self.reward = priceAmount.description

        let anchor = try await getArweaveAnchor()
        self.last_tx = anchor

        self.data_root = ""

        let sigData = try arweaveSignatureDeepHash(
            format: self.format,
            owner: self.owner,
            target: self.target,
            quantity: self.quantity,
            reward: self.reward,
            last_tx: self.last_tx,
            tags: self.tags.map { ($0.name, $0.value) },
            data_size: self.data_size,
            data_root: self.data_root
        )

        let sigDataHash = Data(SHA256.hash(data: sigData))
        let signature = try wallet.secp256k1Sign(hash: sigDataHash)
        self.signature = signature.base64URLEncodedString()
        self.id = Data(SHA256.hash(data: signature)).base64URLEncodedString()
    }
    
    func submit() async throws -> String {
        let jsonString = try toOrderedJSONString()
        
        let urlString = "https://arweave.net/tx"
        guard let url = URL(string: urlString) else {
            throw ArweaveNetworkError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = jsonString.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ArweaveNetworkError.badServerResponse
        }

        print("Arweave POST /tx status: \(httpResponse.statusCode)")
        if let responseString = String(data: data, encoding: .utf8) {
            print("Response body: \(responseString)")
        }

        if httpResponse.statusCode == 200 {
            return id
        } else {
            throw ArweaveNetworkError.badServerResponse
        }
    }

    func getArweaveAnchor() async throws -> String {
        let endpoint = "\(AppConstants.ARWEAVE_BASE_URL)/tx_anchor"
        let (data, response) = try await URLSession.shared.data(from: URL(string: endpoint)!)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw NetworkError.badServerResponse
        }
        guard let anchor = String(data: data, encoding: .utf8) else {
            throw NetworkError.decodingError
        }
        return anchor
    }
    
    func toOrderedJSONString() throws -> String {
            func b64url(_ data: Data) -> String {
                data.base64EncodedString()
                    .replacingOccurrences(of: "+", with: "-")
                    .replacingOccurrences(of: "/", with: "_")
                    .replacingOccurrences(of: "=", with: "")
            }
        
            func tagsJSONString() -> String {
                let tagStrings = tags.map { tag in
                    let name = tag.name.data(using: .utf8)!.base64URLEncodedString()
                    let value = tag.value.data(using: .utf8)!.base64URLEncodedString()
                    return #"{"name":"\#(name)","value":"\#(value)"}"#
                }
                return "[\(tagStrings.joined(separator: ","))]"
            }
        
            let dataString = b64url(data)
        
            let json = """
            {
                "format":\(format),
                "id":"\(id)",
                "last_tx":"\(last_tx)",
                "owner":"\(owner)",
                "tags":\(tagsJSONString()),
                "target":"\(target)",
                "quantity":"\(quantity)",
                "data":"\(dataString)",
                "data_size":"\(data_size)",
                "data_root":"\(data_root)",
                "reward":"\(reward)",
                "signature":"\(signature)"
            }
            """
            return json
        }
    
    func arweaveSignatureDeepHash(
        format: Int,
        owner: String,
        target: String,
        quantity: String,
        reward: String,
        last_tx: String,
        tags: [(String, String)],
        data_size: String,
        data_root: String
    ) throws -> Data {
        func b64urlDecode(_ s: String) -> Data {
            var base64 = s.replacingOccurrences(of: "-", with: "+")
                          .replacingOccurrences(of: "_", with: "/")
            let padding = 4 - base64.count % 4
            if padding < 4 { base64 += String(repeating: "=", count: padding) }
            return Data(base64Encoded: base64) ?? Data()
        }

        let tagList: [Any] = tags.map { tag in
            [Data(tag.0.utf8), Data(tag.1.utf8)]
        }

        var hashList: [Any] = [
            Data(String(format).utf8)
        ]
        if !owner.isEmpty {
            hashList.append(b64urlDecode(owner))
        }
        hashList.append(b64urlDecode(target))
        hashList.append(Data(quantity.utf8))
        hashList.append(Data(reward.utf8))
        hashList.append(b64urlDecode(last_tx))
        hashList.append(tagList)
        hashList.append(Data(data_size.utf8))
        hashList.append(b64urlDecode(data_root))

        return try deepHashData(hashList)
    }
}

enum ArweaveNetworkError: Error {
    case invalidURL
    case badServerResponse
    case encodingError
}

struct ECDSAEthereumTransactionEIP1559: Encodable {
    let chainId: Int
    let nonce: Int
    let maxPriorityFeePerGas: Int
    let maxFeePerGas: Int
    let gasLimit: Int
    let to: String // 20 bytes
    let value: Int
    let data: Data
    let accessList: [[Data]]
    
    init(target: String, amountETH: Double, nonce: Int, chainId: Int) {
        self.chainId = chainId
        self.nonce = nonce
        self.maxPriorityFeePerGas = 100_000_000      // 0.1 gwei (priority)
        self.maxFeePerGas = 5_823_000_000            // 5.823 gwei (average)
        self.gasLimit = 21_000 // Standard ETH transfer
        self.to = target
        self.value = Int(amountETH * 1_000_000_000_000_000_000)
        self.data = Data()
        self.accessList = []
    }
    
    mutating func sign(with wallet: ECDSAWallet) async throws -> String {
        let rlpList: [Any] = [
            chainId,
            nonce,
            maxPriorityFeePerGas,
            maxFeePerGas,
            gasLimit,
            to,
            value,
            data,
            accessList
        ]
        let rlpEncoded = RLPEncoder.encode(rlpList)
        let txTypePrefix = Data([0x02])
        let serialized = txTypePrefix + rlpEncoded
        
        //print("RLP: " + serialized.hexEncodedString())
        
        let txHash = keccak256(serialized)
        //print("TX HASH: " + txHash.hexEncodedString())
        
        let signature = try wallet.secp256k1Sign(hash: txHash)
        //print("SIGNATURE (hex): " + signature.hexEncodedString())
        
        let signatureBytes = [UInt8](signature)
        let r = Data(signatureBytes[0..<32])
        let s = Data(signatureBytes[32..<64])
        let yParity = signatureBytes[64] & 0x01
        
        let signedRlpList: [Any] = [
            chainId,
            nonce,
            maxPriorityFeePerGas,
            maxFeePerGas,
            gasLimit,
            to,
            value,
            data,
            accessList,
            Int(yParity),
            r,
            s
        ]
        let signedRlpEncoded = RLPEncoder.encode(signedRlpList)
        let signedSerialized = txTypePrefix + signedRlpEncoded
        let signedTxHex = signedSerialized.hexEncodedString()

        return signedTxHex
    }
    
    func submit(signedTxHex: String, rpcURL: URL? = nil) async throws -> String {
        let txHash = try await ETHAPI.shared.submitEthereumRawTransaction(rawTxHex: signedTxHex, rpcURL: rpcURL)
        print("ETH TX HASH: " + txHash)
        return txHash
    }
}

struct ECDSAERC20TransactionEIP1559: Encodable {
    let chainId: Int
    let nonce: Int
    let maxPriorityFeePerGas: Int
    let maxFeePerGas: Int
    let gasLimit: Int
    let to: String
    let value: Int
    let data: Data
    let accessList: [[Data]]
    
    init(contract: String, recipient: String, amount: Double, decimals: Int, nonce: Int, chainId: Int) {
        self.chainId = chainId
        self.nonce = nonce
        self.maxPriorityFeePerGas = 100_000_000      // 0.1 gwei (priority)
        self.maxFeePerGas = 5_823_000_000            // 5.823 gwei (average)
        self.gasLimit = 100_000 // Typical ERC20 transfer
        self.to = contract
        self.value = 0
        self.data = ECDSAERC20TransactionEIP1559.encodeERC20TransferData(to: recipient, amount: amount, decimals: decimals)
        self.accessList = []
    }
    
    static func encodeERC20TransferData(to: String, amount: Double, decimals: Int) -> Data {
        // ERC20 transfer(address,uint256) selector: a9059cbb
        let functionSelector = Data([0xa9, 0x05, 0x9c, 0xbb])
        // Pad recipient address to 32 bytes
        let addressHex = to.hasPrefix("0x") ? String(to.dropFirst(2)) : to
        let addressData = Data(hex: addressHex) ?? Data(count: 20)
        let paddedAddress = Data(repeating: 0, count: 12) + addressData // 32 bytes
        // Pad amount to 32 bytes
        let amountInt = UInt64(amount * pow(10, Double(decimals)))
        var amountBytes = withUnsafeBytes(of: amountInt.bigEndian, Array.init)
        // Pad to 32 bytes
        if amountBytes.count < 32 {
            amountBytes = Array(repeating: 0, count: 32 - amountBytes.count) + amountBytes
        }
        let data = functionSelector + paddedAddress + Data(amountBytes)
        return data
    }
    
    mutating func sign(with wallet: ECDSAWallet) async throws -> String {
        let rlpList: [Any] = [
            chainId,
            nonce,
            maxPriorityFeePerGas,
            maxFeePerGas,
            gasLimit,
            to,
            value,
            data,
            accessList
        ]
        let rlpEncoded = RLPEncoder.encode(rlpList)
        let txTypePrefix = Data([0x02])
        let serialized = txTypePrefix + rlpEncoded
        let txHash = keccak256(serialized)
        let signature = try wallet.secp256k1Sign(hash: txHash)
        let signatureBytes = [UInt8](signature)
        let r = Data(signatureBytes[0..<32])
        let s = Data(signatureBytes[32..<64])
        let yParity = signatureBytes[64] & 0x01
        let signedRlpList: [Any] = [
            chainId,
            nonce,
            maxPriorityFeePerGas,
            maxFeePerGas,
            gasLimit,
            to,
            value,
            data,
            accessList,
            Int(yParity),
            r,
            s
        ]
        let signedRlpEncoded = RLPEncoder.encode(signedRlpList)
        let signedSerialized = txTypePrefix + signedRlpEncoded
        let signedTxHex = signedSerialized.hexEncodedString()
        return signedTxHex
    }
    
    func submit(signedTxHex: String, rpcURL: URL? = nil) async throws -> String {
        let txHash = try await ETHAPI.shared.submitEthereumRawTransaction(rawTxHex: signedTxHex, rpcURL: rpcURL)
        print("ERC20 TX HASH: " + txHash)
        return txHash
    }
}
