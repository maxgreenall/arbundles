//
//  AOAPI.swift
//  arweave-ao
//
//  Created by Max Greenall on 20/11/2024.
//

import Foundation
import CryptoKit
import Arweave
import JOSESwift

class DryrunConfig {
    var CU_URL: String
    
    init(CU_URL: String = AppConstants.CU_AO_BASE_URL) {
        self.CU_URL = CU_URL
    }
}

class ResultConfig {
    var CU_URL: String
    
    init(CU_URL: String = AppConstants.CU_AO_BASE_URL) {
        self.CU_URL = CU_URL
    }
}

struct AORequestBody: Codable {
    let Id: String?
    let Target: String
    let Owner: String?
    let Anchor: String
    let Data: String?
    let Tags: [Tag]
    
    struct Tag: Codable {
        let name: String
        let value: String
    }
}

struct AOResponse: Codable {
    struct Message: Codable {
        let Data: String?
        let Tags: [Tag]
        
        struct Tag: Codable {
            let name: String
            let value: String
            
            init(from decoder: Decoder) throws {
                let container = try decoder.container(keyedBy: CodingKeys.self)
                name = try container.decode(String.self, forKey: .name)
                
                // Attempt to decode value as a string, ignore if it's an array
                if let stringValue = try? container.decode(String.self, forKey: .value) {
                    value = stringValue
                } else if let arrayValue = try? container.decode([String].self, forKey: .value) {
                    value = arrayValue.joined(separator: ", ")
                } else {
                    value = ""
                }
            }
            
            enum CodingKeys: String, CodingKey {
                case name
                case value
            }
        }
    }
    
    let Messages: [Message]
}

struct AOMessageResponse: Codable {
    let message: String
    let id: String
}

struct AOResultsResponse: Codable {
    let pageInfo: PageInfo
    let edges: [Edge]
    
    struct PageInfo: Codable {
        let hasNextPage: Bool
    }
    
    struct Edge: Codable {
        let node: AOResult
        let cursor: String
    }
}

struct AOTokenHolder: Identifiable {
    let id = UUID()
    let rank: Int
    let entityId: String
    let balance: Double
}

struct AOResult: Codable {
    struct Message: Codable {
        let Data: String?
        let Anchor: String?
        let Target: String?
        let Tags: [Tag]?
        
        struct Tag: Codable {
            let name: String
            let value: String
        }
    }
    
    struct Spawn: Codable {
        let Data: String
        let Anchor: String
        let Tags: [Tag]
        
        struct Tag: Codable {
            let name: String
            let value: String
            
            init(from decoder: Decoder) throws {
                let container = try decoder.container(keyedBy: CodingKeys.self)
                name = try container.decode(String.self, forKey: .name)
                
                // Attempt to decode value as a string, ignore if it's an array
                if let stringValue = try? container.decode(String.self, forKey: .value) {
                    value = stringValue
                } else {
                    value = ""
                }
            }
        }
    }
    
    let Messages: [Message]?
    let Spawns: [Spawn]?
    let Error: String?
}

func getTokenHolders(tokenInfo: AOToken) async -> [AOTokenHolder] {
    do {
        let result = try await dryRun(
            processId: tokenInfo.id,
            tags: [AORequestBody.Tag(name: "Action", value: "Balances")],
            data: ""
        )

        guard let message = result.Messages.first,
              let data = message.Data?.data(using: .utf8),
              let rawBalanceMap = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            print("No valid balance data for \(tokenInfo.name)")
            return []
        }

        let filteredBalances = rawBalanceMap
            .compactMapValues { val -> Double? in
                if let stringVal = val as? String, let number = Double(stringVal), number != 0 {
                    return number
                } else if let num = val as? NSNumber, num.doubleValue != 0 {
                    return num.doubleValue
                }
                return nil
            }

        let sorted = filteredBalances
            .sorted { $0.value > $1.value }
            .enumerated()
            .map { index, pair in
                AOTokenHolder(
                    rank: index + 1,
                    entityId: pair.key,
                    balance: pair.value / pow(10, Double(tokenInfo.decimals))
                )
            }

        return sorted
    } catch {
        print("Failed to fetch token holders: \(error.localizedDescription)")
        return []
    }
}

struct Buffer: Decodable {
    let type: String
    let data: [UInt8]
}

let tokenMirrors: [String: DryrunConfig] = [
    AppConstants.ARIO_PROCESS: arioDryrunConfig
]

/// Fetches the balance for an address given a process ID
func getAOBalance(for address: String, processId: String = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc") async throws -> String {
    let tags = [
        AORequestBody.Tag(name: "Action", value: "Balance"),
        AORequestBody.Tag(name: "Recipient", value: address)
    ]
    
    let pId = processId
    
    let dryrunConfig = tokenMirrors[processId]
        ?? DryrunConfig(CU_URL: AppConstants.CU_AO_BASE_URL)
    
    let fallbackDryrunConfig = tokenMirrors[processId] != nil
        ? DryrunConfig(CU_URL: AppConstants.CU_AO_BASE_URL)
        : DryrunConfig(CU_URL: AppConstants.CU_ARIO_BASE_URL)
    
    do {
        let result = try await dryRun(
            processId: pId,
            tags: tags,
            config: dryrunConfig
        )
        return try extractBalance(from: result)
    } catch {
        let result = try await dryRun(
            processId: pId,
            tags: tags,
            config: fallbackDryrunConfig
        )
        return try extractBalance(from: result)
    }
}

private func extractBalance(from result: AOResponse) throws -> String {
    if let firstMessage = result.Messages.first {
        if let balanceTag = firstMessage.Tags.first(where: { $0.name == "Balance" }) {
            return balanceTag.value
        }
        
        if let data = firstMessage.Data {
            if let parsedBalance = Int(data.trimmingCharacters(in: CharacterSet(charactersIn: "\""))) {
                return String(parsedBalance)
            }
        }
    }
    
    throw NSError(domain: "No valid balance found in response", code: 0, userInfo: nil)
}

/// Fetches token info given a process ID
func getAOTokenInfo(processId: String) async throws -> AOToken {
    let tags = [
        AORequestBody.Tag(name: "Action", value: "Info")
    ]
    
    let result: AOResponse
    do {
        let config = DryrunConfig(CU_URL: AppConstants.CU_AO_BASE_URL)
        
        result = try await dryRun(
            processId: processId,
            tags: tags,
            config: config)
    } catch {
        let config = DryrunConfig(CU_URL: AppConstants.CU_ARIO_BASE_URL)
        
        result = try await dryRun(
            processId: processId,
            tags: tags,
            config: config)
    }
    
    if let message = result.Messages.first {
        var denomination: String?
        var logo: String?
        var ticker: String?
        var name: String?
        
        for tag in message.Tags {
            switch tag.name {
            case "Denomination":
                denomination = tag.value
            case "Logo":
                logo = tag.value
            case "Ticker":
                ticker = tag.value
            case "Name":
                name = tag.value
            default:
                continue
            }
        }
        
        if let denomination = denomination, let logo = logo, let ticker = ticker, let name = name {
            return AOToken(processId: processId, denomination: denomination, logo: logo, ticker: ticker, name: name)
        } else {
            throw NSError(domain: "No Token", code: 0, userInfo: nil)
        }
        
    } else {
        throw NSError(domain: "No Token", code: 0, userInfo: nil)
    }
}

/// Send a message to a specific process and return the result without the memory being saved
func dryRun(processId: String, tags: [AORequestBody.Tag], data: String = "{}", config: DryrunConfig = DryrunConfig()) async throws -> AOResponse {
    let endpoint = "\(config.CU_URL)/dry-run?process-id=\(processId)"
    
    let tags = tags + [
        AORequestBody.Tag(name: "Data-Protocol", value: "ao"),
        AORequestBody.Tag(name: "Type", value: "Message"),
        AORequestBody.Tag(name: "Variant", value: "ao.TN.1")
    ]
    
    let requestBody: [String: Any] = [
        "Id": "1234",
        "Target": processId,
        "Owner": "1234",
        "Anchor": "1234",
        "Data": data,
        "Tags": tags.map { ["name": $0.name, "value": $0.value] }
    ]
    
    return try await makePostRequest(endpoint: endpoint, body: requestBody)
}

/// Send a message to a specific process
func sendMessage(signer: Wallet, target: String?, tags: [Tag], data: Data) async throws -> AOMessageResponse {
    let allTags = tags +
        [
            Tag(name: "SDK", value: "Beacon Wallet"),
            Tag(name: "Data-Protocol", value: "ao"),
            Tag(name: "Variant", value: "ao.TN.1"),
            Tag(name: "Type", value: "Message"),
        ]

    var dataItem = createDataItem(data: data, signer: signer, tags: allTags, target: target)
    let signedDataItem = try await dataItem.sign(wallet: signer)
    
    return try await makeBinaryPostRequest(endpoint: AppConstants.MU_AO_BASE_URL, body: signedDataItem, expectedStatusCodes: [202])
}

func sendDataItem(signedDataItem: Data) async throws -> AOMessageResponse {
    return try await makeBinaryPostRequest(endpoint: AppConstants.MU_AO_BASE_URL, body: signedDataItem, expectedStatusCodes: [202])
}

/// Send a message to a specific process given a signed DataItem
func sendMessageData(data: Data) async throws -> AOMessageResponse {
    return try await makeBinaryPostRequest(endpoint: AppConstants.MU_AO_BASE_URL, body: data, expectedStatusCodes: [202])
}


/// Spawn a process given a valid ModuleID
func spawn(signer: Wallet, module: String, scheduler: String = "_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA", data: Data, tags: [Tag], contentType: String = "Module") async throws -> AOMessageResponse {
    let allTags = tags +
        [
            Tag(name: "SDK", value: "Beacon Wallet"),
            Tag(name: "Data-Protocol", value: "ao"),
            Tag(name: "Variant", value: "ao.TN.1"),
            Tag(name: "Type", value: "Process"),
            Tag(name: "Content-Type", value: contentType),
            Tag(name: "Module", value: module),
            Tag(name: "Scheduler", value: scheduler),
            Tag(name: "Authority", value: AppConstants.AO_AUTHORITY)
        ]

    var dataItem = createDataItem(data: data, signer: signer, tags: allTags, target: nil)
    print("Input data size: \(data.count) bytes (\(String(format: "%.2f", Double(data.count) / 1024.0 / 1024.0)) MB)")

    let signedDataItem = try await dataItem.sign(wallet: signer)
    
    return try await makeBinaryPostRequest(endpoint: AppConstants.MU_AO_BASE_URL, body: signedDataItem, expectedStatusCodes: [202])
}


/// Read the result of a message made available by Compute Units (CUs)
func result(messageId: String, processId: String, config: ResultConfig = ResultConfig()) async throws -> AOResult {
    let endpoint = "\(config.CU_URL)/result/\(messageId)?process-id=\(processId)"
    
    let aoResult: AOResult = try await makeGetRequest(endpoint: endpoint)
    
    if let error = aoResult.Error {
        throw error
    }
    
    return aoResult
}

/// Reads multiple results of a message node. Sort expects DESC or ASC
func results(processId: String, limit: Int = 4, sort: String = "DESC", config: ResultConfig = ResultConfig()) async throws -> [AOResult] {
    let endpoint = "\(config.CU_URL)/results/\(processId)?sort=\(sort)&limit=\(limit)"
    
    let aoResultsResponse: AOResultsResponse = try await makeGetRequest(endpoint: endpoint)
    
    if let error = aoResultsResponse.edges.first?.node.Error {
        throw NSError(domain: "AO Error", code: 0, userInfo: [NSLocalizedDescriptionKey: error])
    }
    
    return aoResultsResponse.edges.map { $0.node }
}

func createDataItem(data: Data, signer: Wallet, tags: [Tag], target: String?) -> DataItem {
    let signature = Data()
    let owner = base64UrlToUint8Array(signer.ownerModulus)
    let targetData = target != nil ? pad(data: base64UrlToUint8Array(target!), toLength: 32) : nil
    let anchor: Data? = nil
    let dataBytes = data
    
    return DataItem(
        signature: signature,
        owner: owner,
        target: targetData,
        anchor: anchor,
        tags: tags,
        data: dataBytes
    )
}

func createDataItem(data: String, modulus: String, tags: [Tag], target: String?, anchor: String? = nil) -> DataItem {
    let signature = Data()
    let owner = base64UrlToUint8Array(modulus)
    let targetData = target != nil ? pad(data: base64UrlToUint8Array(target!), toLength: 32) : nil
    let anchorData: Data? = anchor != nil ? pad(data: base64UrlToUint8Array(anchor!), toLength: 32) : nil
    let dataBytes = data.data(using: .utf8)!
    
    return DataItem(
        signature: signature,
        owner: owner,
        target: targetData,
        anchor: anchorData,
        tags: tags,
        data: dataBytes
    )
}

private func pad(data: Data, toLength length: Int) -> Data {
    if data.count >= length {
        return data.prefix(length)
    } else {
        var paddedData = data
        paddedData.append(Data(count: length - data.count))
        return paddedData
    }
}

struct Tag: Codable {
    let name: String
    let value: String
}

struct DataItem: Codable {
    let signatureType: Int = 1
    var signature: Data?
    var owner: Data?
    let target: Data?
    let anchor: Data?
    let tags: [Tag]
    let data: Data
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        
        if let signatureString = try container.decodeIfPresent(String.self, forKey: .signature) {
            signature = Data(base64Encoded: signatureString)
        } else {
            signature = try container.decodeIfPresent(Data.self, forKey: .signature)
        }
        
        if let ownerString = try container.decodeIfPresent(String.self, forKey: .owner) {
            owner = Data(base64Encoded: ownerString)
        } else {
            owner = try container.decodeIfPresent(Data.self, forKey: .owner)
        }
        
        if let targetString = try container.decodeIfPresent(String.self, forKey: .target) {
            target = targetString.data(using: .utf8)
        } else {
            target = try container.decodeIfPresent(Data.self, forKey: .target)
        }
        
        if let anchorString = try container.decodeIfPresent(String.self, forKey: .anchor) {
            anchor = Data(base64Encoded: anchorString)
        } else {
            anchor = try container.decodeIfPresent(Data.self, forKey: .anchor)
        }
        
        tags = try container.decode([Tag].self, forKey: .tags)
                
        if let dataString = try? container.decode(String.self, forKey: .data) {
            if let decodedData = dataString.data(using: .utf8) {
                data = decodedData
            } else {
                data = Data()
            }
        } else if let bufferObject = try? container.decode(Buffer.self, forKey: .data), bufferObject.type == "Buffer" {
            data = Data(bufferObject.data)
        } else if let uint8Object = try? container.decode([String: UInt8].self, forKey: .data) {
            let sortedKeys = uint8Object.keys.compactMap { Int($0) }.sorted()
            let byteArray = sortedKeys.compactMap { uint8Object["\($0)"] }
            data = Data(byteArray)
        } else {
            data = Data()
        }
    }

    // Custom encoding logic
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        
        if let signature = signature {
            try container.encode(signature.base64EncodedString(), forKey: .signature)
        }
        
        if let owner = owner {
            try container.encode(owner.base64EncodedString(), forKey: .owner)
        }
        
        if let target = target {
            try container.encode(target.base64EncodedString(), forKey: .target)
        }
        
        if let anchor = anchor {
            try container.encode(anchor.base64EncodedString(), forKey: .anchor)
        }
        
        try container.encode(tags, forKey: .tags)
        try container.encode(data.base64EncodedString(), forKey: .data)
    }
    
    init(signature: Data?, owner: Data, target: Data?, anchor: Data?, tags: [Tag], data: Data) {
        self.signature = signature ?? Data()
        self.owner = owner
        self.target = target
        self.anchor = anchor
        self.tags = tags
        self.data = data
    }

    enum CodingKeys: String, CodingKey {
        case signature
        case owner
        case target
        case anchor
        case tags
        case data
    }

    func encode(signature: Data?) -> Data {
        var rawData: Data
        var rawAnchor: Data
        var rawOwner: Data
        var rawSignature: Data
        var rawTags: Data
        var rawTarget: Data
        
        var encodedData = Data()
        
        // Encode signatureType (2 bytes, padded)
        var signatureTypePadded = [1, 0]
        encodedData.append(Data(bytes: &signatureTypePadded, count: 2))
        
        // Encode signature (variable length)
        rawSignature = signature ?? Data(count: 512)
        encodedData.append(rawSignature)
        
        // Encode owner (512 bytes)
        rawOwner = owner ?? Data(count: 512)
        encodedData.append(rawOwner)
        
        // Encode target (32 bytes + presence byte)
        if let target = target {
            encodedData.append(1)
            rawTarget = target
            encodedData.append(rawTarget)
        } else {
            encodedData.append(0)
        }
        
        // Encode anchor (32 bytes + presence byte)
        if let anchor = anchor {
            encodedData.append(1)
            rawAnchor = anchor
            encodedData.append(rawAnchor)
        } else {
            encodedData.append(0)
        }
        
        let serializer = TagSerializer()
        try! serializer.writeTags(tags)
        let serializedData = serializer.toData()
        
        let numTags = encodeInteger(tags.count)
        encodedData.append(numTags)

        rawTags = Data(serializedData)
        let numTagBytes = encodeInteger(rawTags.count)
        encodedData.append(numTagBytes)
        encodedData.append(rawTags)
        
        // Encode data (variable length)
        rawData = data
        encodedData.append(rawData)
        
        return encodedData
    }
        
    mutating func sign(wallet: Wallet) async throws -> Data {
        let serializer = TagSerializer()
        try! serializer.writeTags(tags)
        let rawTags = serializer.toData()
        
        let messageToHash: [Data] = [
            "dataitem".data(using: .utf8)!,
            "1".data(using: .utf8)!,
            "1".data(using: .utf8)!,
            owner ?? wallet.address.address.data(using: .utf8)!,
            target ?? Data(),
            anchor ?? Data(),
            rawTags,
            data
        ]
        
        let message = try deepHash(messageToHash)
        signature = try wallet.sign(message)
        
        return encode(signature: signature)
    }
    
    func generateID() -> Data {
        let hash = SHA256.hash(data: signature!)
        return Data(hash)
    }
}

func base64UrlToUint8Array(_ base64Url: String) -> Data {
    var base64 = base64Url.replacingOccurrences(of: "-", with: "+")
                          .replacingOccurrences(of: "_", with: "/")
    
    let paddingLength = 4 - (base64.count % 4)
    if paddingLength < 4 {
        base64.append(String(repeating: "=", count: paddingLength))
    }
    
    let data = Data(base64Encoded: base64)!
    
    return data
}

private func encodeInteger(_ count: Int, length: Int = 8) -> Data {
    var numberOfTags = UInt64(count).littleEndian
    return Data(bytes: &numberOfTags, count: length)
}

private class TagSerializer {
    private var buffer: [UInt8]
    private var position: Int

    init(bufferSize: Int = 1024) {
        self.buffer = [UInt8](repeating: 0, count: bufferSize)
        self.position = 0
    }

    func writeTags(_ tags: [Tag]) throws {
        guard !tags.isEmpty else {
            throw NSError(domain: "TagSerializer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Input must be an array"])
        }

        let n = tags.count
        try writeLong(n)
        for tag in tags {
            guard let name = tag.name.data(using: .utf8), let value = tag.value.data(using: .utf8) else {
                throw NSError(domain: "TagSerializer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid tag format"])
            }
            try writeString(name)
            try writeString(value)
        }
        try writeLong(0)
    }

    func toData() -> Data {
        return Data(buffer.prefix(position))
    }

    private func writeLong(_ value: Int) throws {
        var zigzag = (value << 1) ^ (value >> 31)
        while (zigzag & ~0x7F) != 0 {
            try writeByte(UInt8((zigzag & 0x7F) | 0x80))
            zigzag >>= 7
        }
        try writeByte(UInt8(zigzag & 0x7F))
    }

    private func writeString(_ string: Data) throws {
        try writeLong(string.count)
        try writeBytes(string)
    }

    private func writeByte(_ byte: UInt8) throws {
        guard position < buffer.count else {
            throw NSError(domain: "TagSerializer", code: 3, userInfo: [NSLocalizedDescriptionKey: "Buffer overflow"])
        }
        buffer[position] = byte
        position += 1
    }

    private func writeBytes(_ bytes: Data) throws {
        guard position + bytes.count <= buffer.count else {
            throw NSError(domain: "TagSerializer", code: 3, userInfo: [NSLocalizedDescriptionKey: "Buffer overflow"])
        }
        buffer.replaceSubrange(position..<position + bytes.count, with: bytes)
        position += bytes.count
    }
}

func stringToBuffer(_ string: String) -> Data {
    return string.data(using: .utf8) ?? Data()
}

// MARK: - ECDSA DataItem

struct ECDSADataItem: Codable {
    var signatureType: Int = 3
    var signature: Data?
    var owner: Data?
    let target: Data?
    let anchor: Data?
    let tags: [Tag]
    let data: Data
    
    init(signature: Data?, owner: Data, target: Data?, anchor: Data?, tags: [Tag], data: Data) {
        self.signature = signature ?? Data(count: 65)
        self.owner = owner
        self.target = target
        self.anchor = anchor
        self.tags = tags
        self.data = data
    }

    func encode(signature: Data?) -> Data {
        var encodedData = Data()
        
        // Encode signatureType (2 bytes, little endian)
        var signatureTypePadded = UInt16(3).littleEndian
        encodedData.append(Data(bytes: &signatureTypePadded, count: 2))
        
        // Encode signature (65 bytes for ECDSA)
        let rawSignature = signature ?? Data(count: 65)
        encodedData.append(rawSignature)
        
        // Encode owner (65 bytes for ECDSA uncompressed public key)
        let rawOwner = owner ?? Data(count: 65)
        encodedData.append(rawOwner)
        
        // Encode target (32 bytes + presence byte)
        if let target = target, !target.isEmpty {
            encodedData.append(1)
            let paddedTarget = target.count >= 32 ? target.prefix(32) : target + Data(count: 32 - target.count)
            encodedData.append(paddedTarget)
        } else {
            encodedData.append(0)
        }
        
        // Encode anchor (32 bytes + presence byte)
        if let anchor = anchor, !anchor.isEmpty {
            encodedData.append(1)
            let paddedAnchor = anchor.count >= 32 ? anchor.prefix(32) : anchor + Data(count: 32 - anchor.count)
            encodedData.append(paddedAnchor)
        } else {
            encodedData.append(0)
        }
        
        // Encode tags
        let serializer = TagSerializer()
        try! serializer.writeTags(tags)
        let serializedTags = serializer.toData()
        
        let numTags = encodeInteger(tags.count)
        encodedData.append(numTags)
        
        let numTagBytes = encodeInteger(serializedTags.count)
        encodedData.append(numTagBytes)
        encodedData.append(serializedTags)
        
        // Encode data (variable length)
        encodedData.append(data)
        
        return encodedData
    }
    
         mutating func sign(wallet: ECDSAWallet) throws -> Data {
         // Create signature data using deepHash
         let serializer = TagSerializer()
         try serializer.writeTags(tags)
         let rawTags = serializer.toData()
         
         let messageToHash: [Any] = [
             stringToBuffer("dataitem"),
             stringToBuffer("1"),
             stringToBuffer("\(signatureType)"),
             owner ?? Data(),
             target ?? Data(),
             anchor ?? Data(),
             rawTags,
             data
         ]
         
         // Use existing deepHashData implementation from Deephash.swift
         let message = try deepHashData(messageToHash)
         
         // Use Ethereum message signing instead of raw ECDSA signing
         print("About to do Ethereum message signing...")
         print("Raw deepHash message length: \(message.count)")
         print("Raw deepHash message hex: \(message.map { String(format: "%02x", $0) }.joined())")
         
         // Create Ethereum message format for debugging
         let prefix = "\u{19}Ethereum Signed Message:\n"
         let prefixData = prefix.data(using: .utf8)!
         let lengthString = "\(message.count)"
         let lengthData = lengthString.data(using: .utf8)!
         
         var ethereumMessage = Data()
         ethereumMessage.append(prefixData)
         ethereumMessage.append(lengthData)
         ethereumMessage.append(message)
         
         print("Ethereum message prefix hex: \(prefixData.map { String(format: "%02x", $0) }.joined())")
         print("Ethereum message length string: '\(lengthString)'")
         print("Ethereum message length hex: \(lengthData.map { String(format: "%02x", $0) }.joined())")
         print("Full Ethereum message length: \(ethereumMessage.count)")
         print("Full Ethereum message hex: \(ethereumMessage.map { String(format: "%02x", $0) }.joined())")
         
         // Hash with keccak256
         let ethereumMessageHash = keccak256(ethereumMessage)
         print("Ethereum message hash (keccak256) hex: \(ethereumMessageHash.map { String(format: "%02x", $0) }.joined())")
         
         // Sign with Ethereum message signing
         signature = try wallet.ethereumSignMessage(message)
         
         return encode(signature: signature)
     }
    
    func generateID() -> Data {
        let hash = SHA256.hash(data: signature!)
        return Data(hash)
    }
}

func createECDSADataItem(data: Data, wallet: ECDSAWallet, tags: [Tag], target: String?) -> ECDSADataItem {
    let targetData = target != nil ? pad(data: base64UrlToUint8Array(target!), toLength: 32) : nil
    let anchor: Data? = nil
    
         // For ECDSA, we need the uncompressed public key (65 bytes)
     let publicKeyData: Data
     do {
         let uncompressedKey = try ECDSAWallet.getPublicKeyBytes(from: wallet.privateKeyHex, compressed: false)
         publicKeyData = Data(uncompressedKey)
     } catch {
         publicKeyData = Data(count: 65) // fallback
     }
    
    return ECDSADataItem(
        signature: nil,
        owner: publicKeyData,
        target: targetData,
        anchor: anchor,
        tags: tags,
        data: data
    )
}

// MARK: - ECDSA Message Sending

func sendMessageECDSA(wallet: ECDSAWallet, target: String?, tags: [Tag], data: Data) async throws -> AOMessageResponse {
    let allTags = tags +
        [
            Tag(name: "SDK", value: "Beacon Wallet"),
            Tag(name: "Data-Protocol", value: "ao"),
            Tag(name: "Variant", value: "ao.TN.1"),
            Tag(name: "Type", value: "Message"),
        ]

    var dataItem = createECDSADataItem(data: data, wallet: wallet, tags: allTags, target: target)
    let signedDataItem = try dataItem.sign(wallet: wallet)
    
    return try await makeBinaryPostRequest(endpoint: AppConstants.MU_AO_BASE_URL, body: signedDataItem, expectedStatusCodes: [202])
}

/// Spawn a new AO process using an ECDSA wallet
func spawnECDSA(wallet: ECDSAWallet, module: String, scheduler: String = "_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA", data: Data, tags: [Tag], contentType: String = "Module") async throws -> AOMessageResponse {
    let allTags = tags +
        [
            Tag(name: "SDK", value: "Beacon Wallet"),
            Tag(name: "Data-Protocol", value: "ao"),
            Tag(name: "Variant", value: "ao.TN.1"),
            Tag(name: "Type", value: "Process"),
            Tag(name: "Content-Type", value: contentType),
            Tag(name: "Module", value: module),
            Tag(name: "Scheduler", value: scheduler),
            Tag(name: "Authority", value: AppConstants.AO_AUTHORITY)
        ]

    var dataItem = createECDSADataItem(data: data, wallet: wallet, tags: allTags, target: nil)
    print("Input data size: \(data.count) bytes (\(String(format: "%.2f", Double(data.count) / 1024.0 / 1024.0)) MB)")

    let signedDataItem = try dataItem.sign(wallet: wallet)
    
    return try await makeBinaryPostRequest(endpoint: AppConstants.MU_AO_BASE_URL, body: signedDataItem, expectedStatusCodes: [202])
}

/// Send a signed ECDSA DataItem
func sendECDSADataItem(signedDataItem: Data) async throws -> AOMessageResponse {
    return try await makeBinaryPostRequest(endpoint: AppConstants.MU_AO_BASE_URL, body: signedDataItem, expectedStatusCodes: [202])
}

/// Create and sign an ECDSA DataItem for AO messages (without sending)
func createSignedECDSADataItem(wallet: ECDSAWallet, target: String?, tags: [Tag], data: Data, isProcess: Bool = false, module: String? = nil, scheduler: String = "_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA", contentType: String = "Module") throws -> Data {
    var allTags = tags +
        [
            Tag(name: "SDK", value: "Beacon Wallet"),
            Tag(name: "Data-Protocol", value: "ao"),
            Tag(name: "Variant", value: "ao.TN.1"),
        ]
    
    if isProcess {
        allTags.append(contentsOf: [
            Tag(name: "Type", value: "Process"),
            Tag(name: "Content-Type", value: contentType),
            Tag(name: "Module", value: module ?? ""),
            Tag(name: "Scheduler", value: scheduler),
            Tag(name: "Authority", value: AppConstants.AO_AUTHORITY)
        ])
    } else {
        allTags.append(Tag(name: "Type", value: "Message"))
    }

    var dataItem = createECDSADataItem(data: data, wallet: wallet, tags: allTags, target: target)
    return try dataItem.sign(wallet: wallet)
}

func testECDSASigningMatchJS() {
    do {
        print("========== SWIFT ECDSA SIGNING DEBUG TEST (MATCHING JS) ==========")
        
        // Use EXACT same private key as JavaScript test
        let testPrivateKey = "3afdfe893b2680adc1eda213dbc94ba07b7f923fcb42afe13956f7ac7f619344"
        let wallet = try ECDSAWallet(name: "Test Wallet", privateKeyHex: testPrivateKey)
        
        // Show public key for comparison with JS
        let publicKeyBytes = try ECDSAWallet.getPublicKeyBytes(from: testPrivateKey, compressed: false)
        print("Signer public key: \(Data(publicKeyBytes).map { String(format: "%02x", $0) }.joined())")
        print("Signer public key length: \(publicKeyBytes.count)")
        
        // Use EXACT same data as JavaScript test
        let testData = "Hello AO from Node.js!".data(using: .utf8)!
        print("Message data: Hello AO from Node.js!")
        print("Message data hex: \(testData.map { String(format: "%02x", $0) }.joined())")
        
        // Use EXACT same tags as JavaScript test
        let testTags = [
            Tag(name: "Data-Protocol", value: "ao"),
            Tag(name: "Variant", value: "ao.TN.1"),
            Tag(name: "Type", value: "Message"),
            Tag(name: "SDK", value: "arbundles-node"),
            Tag(name: "Action", value: "ETH Signer")
        ]
        print("Tags: \(testTags)")
        
        // Use EXACT same anchor as JavaScript test (from the output)
        let anchor = "33333333333333333333331753565726"
        print("Using anchor: \(anchor)")
        
        // Use EXACT same target as JavaScript test
        let targetProcess = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc"
        print("Target process: \(targetProcess)")
        
        print("Creating data item...")
        print("Data item created, now signing...")
        
        // Create the data item with target and anchor to match JS exactly
        let targetData = pad(data: base64UrlToUint8Array(targetProcess), toLength: 32)
        let anchorData = pad(data: anchor.data(using: .utf8)!, toLength: 32)
        
        var dataItem = ECDSADataItem(
            signature: nil,
            owner: Data(publicKeyBytes),
            target: targetData,
            anchor: anchorData,
            tags: testTags,
            data: testData
        )
        
        print("Pre-sign data item signature type: \(dataItem.signatureType)")
        print("Pre-sign data item owner length: \(dataItem.owner?.count ?? 0)")
        print("Pre-sign data item owner hex: \((dataItem.owner ?? Data()).map { String(format: "%02x", $0) }.joined())")
        
        // Add detailed debugging like JavaScript
        print("=== Swift Signing Process ===")
        print("=== Swift DataItem Debug Info ===")
        print("signatureType: \(dataItem.signatureType)")
        print("rawOwner length: \(dataItem.owner?.count ?? 0)")
        print("rawOwner hex: \((dataItem.owner ?? Data()).map { String(format: "%02x", $0) }.joined())")
        print("rawTarget length: \(dataItem.target?.count ?? 0)")
        print("rawTarget hex: \((dataItem.target ?? Data()).map { String(format: "%02x", $0) }.joined())")
        print("rawAnchor length: \(dataItem.anchor?.count ?? 0)")
        print("rawAnchor hex: \((dataItem.anchor ?? Data()).map { String(format: "%02x", $0) }.joined())")
        
        // Serialize tags to show debugging
        let serializer = TagSerializer()
        try serializer.writeTags(testTags)
        let rawTags = serializer.toData()
        print("rawTags length: \(rawTags.count)")
        print("rawTags hex: \(rawTags.map { String(format: "%02x", $0) }.joined())")
        
        print("rawData length: \(testData.count)")
        print("rawData hex: \(testData.map { String(format: "%02x", $0) }.joined())")
        
        // Show deepHash input structure
        print("=== DeepHash Input Structure ===")
        let dataitemString = "dataitem"
        let oneString = "1"
        let signatureTypeString = "\(dataItem.signatureType)"
        
        print("[0] dataitem: \(dataitemString.data(using: .utf8)!.map { String(format: "%02x", $0) }.joined())")
        print("[1] 1: \(oneString.data(using: .utf8)!.map { String(format: "%02x", $0) }.joined())")
        print("[2] signatureType: \(signatureTypeString.data(using: .utf8)!.map { String(format: "%02x", $0) }.joined())")
        print("[3] rawOwner: \((dataItem.owner ?? Data()).map { String(format: "%02x", $0) }.joined())")
        print("[4] rawTarget: \((dataItem.target ?? Data()).map { String(format: "%02x", $0) }.joined())")
        print("[5] rawAnchor: \((dataItem.anchor ?? Data()).map { String(format: "%02x", $0) }.joined())")
        print("[6] rawTags: \(rawTags.map { String(format: "%02x", $0) }.joined())")
        print("[7] rawData: \(testData.map { String(format: "%02x", $0) }.joined())")
        
        // Now perform the signing with detailed deepHash debugging
        let messageToHash: [Any] = [
            stringToBuffer("dataitem"),
            stringToBuffer("1"),
            stringToBuffer("\(dataItem.signatureType)"),
            dataItem.owner ?? Data(),
            dataItem.target ?? Data(),
            dataItem.anchor ?? Data(),
            rawTags,
            testData
        ]
        
        // Use the deepHashData function that includes debugging
        let message = try deepHashData(messageToHash)
        print("deepHash result hex: \(message.map { String(format: "%02x", $0) }.joined())")
        print("===============================")
        
        print("Signature data ready, length: \(message.count)")
        
        // Sign with Ethereum message signing
        let signature = try wallet.ethereumSignMessage(message)
        dataItem.signature = signature
        
        print("ECDSA signature hex: \(signature.map { String(format: "%02x", $0) }.joined())")
        print("ECDSA signature length: \(signature.count)")
        
        // Generate ID
        let id = dataItem.generateID()
        print("DataItem ID hex: \(id.map { String(format: "%02x", $0) }.joined())")
        print("==================================")
        
        print("=== POST-SIGNING RESULTS ===")
        print("Signed data item created")
        
        // Convert ID to base64url for display
        let idBase64Url = id.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        print("Data Item ID: \(idBase64Url)")
        
        // Encode the full data item to get size
        let signedDataItem = dataItem.encode(signature: signature)
        print("Data item size: \(signedDataItem.count) bytes")
        
        // Convert signature to base64url for display
        let signatureBase64Url = signature.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        print("Final signature hex: \(signatureBase64Url)")
        print("Final signature length: \(signature.count)")
        print("============================")
        print("==================================================================")
        
    } catch {
        print("Error in Swift ECDSA signing test: \(error)")
    }
}

/// Test function that creates and submits an ECDSA transaction with custom variables
func testECDSASubmissionWithDifferentVariables() async {
    do {
        print("========== SWIFT ECDSA SUBMISSION TEST (CUSTOM VARIABLES) ==========")
        
        // Use a different private key
        let testPrivateKey = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
        let wallet = try ECDSAWallet(name: "Custom Test Wallet", privateKeyHex: testPrivateKey)
        
        // Show wallet info
        let publicKeyBytes = try ECDSAWallet.getPublicKeyBytes(from: testPrivateKey, compressed: false)
        print("Swift custom signer public key: \(Data(publicKeyBytes).map { String(format: "%02x", $0) }.joined())")
        print("Swift custom wallet Arweave address: \(wallet.getArweaveAddress())")
        
        // Use different custom data
        let testData = "Swift ECDSA Test Message - Hello AO Network!".data(using: .utf8)!
        print("Swift custom message data: Swift ECDSA Test Message - Hello AO Network!")
        print("Swift custom message data hex: \(testData.map { String(format: "%02x", $0) }.joined())")
        
        // Use different custom tags
        let testTags = [
            Tag(name: "Action", value: "SwiftTest"),
            Tag(name: "Platform", value: "iOS"),
            Tag(name: "Version", value: "1.0"),
            Tag(name: "TestType", value: "ECDSA-Submission"),
            Tag(name: "Timestamp", value: "\(Int(Date().timeIntervalSince1970))")
        ]
        print("Swift custom tags: \(testTags)")
        
        // Use different target process (let's try a different AO process)
        let targetProcess = "GYrbbe0VbHim_7Hi6zrOpHQXrSQz07KSTtzDaQTAh9E" // Example AO process
        print("Swift custom target process: \(targetProcess)")
        
        // Use different anchor
        let anchor = "swift-test-\(Int(Date().timeIntervalSince1970))"
        print("Swift custom anchor: \(anchor)")
        
        print("Creating custom ECDSA data item...")
        
        // Method 1: Use the convenience function
        print("=== METHOD 1: Using sendMessageECDSA convenience function ===")
        let response1 = try await sendMessageECDSA(
            wallet: wallet,
            target: targetProcess,
            tags: testTags,
            data: testData
        )
        
        print("✅ Message sent successfully!")
        print("📨 Message ID: \(response1.id)")
        print("📝 Response: \(response1.message)")
        
        // Method 2: Manual creation and submission
        print("\n=== METHOD 2: Manual DataItem creation and submission ===")
        
        // Create custom data item manually
        let targetData = pad(data: base64UrlToUint8Array(targetProcess), toLength: 32)
        let anchorData = pad(data: anchor.data(using: .utf8)!, toLength: 32)
        
        // Add AO protocol tags manually
        let allTags = testTags + [
            Tag(name: "SDK", value: "Beacon Wallet"),
            Tag(name: "Data-Protocol", value: "ao"),
            Tag(name: "Variant", value: "ao.TN.1"),
            Tag(name: "Type", value: "Message"),
        ]
        
        var dataItem = ECDSADataItem(
            signature: nil,
            owner: Data(publicKeyBytes),
            target: targetData,
            anchor: anchorData,
            tags: allTags,
            data: testData
        )
        
        print("Signing custom data item...")
        let signedDataItem = try dataItem.sign(wallet: wallet)
        
        print("📦 Signed data item size: \(signedDataItem.count) bytes")
        print("🔑 Signature hex: \((dataItem.signature ?? Data()).map { String(format: "%02x", $0) }.joined())")
        print("🆔 DataItem ID: \(dataItem.generateID().map { String(format: "%02x", $0) }.joined())")
        
        print("Submitting manually created data item...")
        let response2 = try await sendECDSADataItem(signedDataItem: signedDataItem)
        
        print("✅ Manual submission successful!")
        print("📨 Message ID: \(response2.id)")
        print("📝 Response: \(response2.message)")
        
        // Method 3: Test process spawning with ECDSA
        print("\n=== METHOD 3: Spawning a process with ECDSA ===")
        
        let processData = """
        -- Custom AO Process spawned with ECDSA signature
        local json = require('json')
        
        Handlers.add('info', 
          Handlers.utils.hasMatchingTag('Action', 'Info'),
          function(msg)
            ao.send({
              Target = msg.From,
              Data = json.encode({
                spawned_by = "Swift ECDSA Wallet",
                address = "\(wallet.getArweaveAddress())",
                timestamp = "\(Int(Date().timeIntervalSince1970))"
              })
            })
          end
        )
        """.data(using: .utf8)!
        
        let processTags = [
            Tag(name: "Name", value: "Swift-ECDSA-Process"),
            Tag(name: "Description", value: "Process spawned using Swift ECDSA implementation"),
            Tag(name: "Creator", value: wallet.getArweaveAddress())
        ]
        
        // Use a known AO module for Lua processes
        let moduleId = "GYrbbe0VbHim_7Hi6zrOpHQXrSQz07KSTtzDaQTAh9E" // Example Lua module
        
        let spawnResponse = try await spawnECDSA(
            wallet: wallet,
            module: moduleId,
            data: processData,
            tags: processTags
        )
        
        print("✅ Process spawned successfully!")
        print("🚀 Process ID: \(spawnResponse.id)")
        print("📝 Response: \(spawnResponse.message)")
        
        print("==================================================================")
        print("🎉 All ECDSA tests completed successfully!")
        print("🔗 Check your messages at: https://ao-testnet.xyz/entity/\(response1.id)")
        print("🔗 Check your process at: https://ao-testnet.xyz/entity/\(spawnResponse.id)")
        print("==================================================================")
        
    } catch {
        print("❌ Error in Swift ECDSA submission test: \(error)")
        if let error = error as? NSError {
            print("📋 Error details: \(error.localizedDescription)")
            print("📋 Error domain: \(error.domain)")
            print("📋 Error code: \(error.code)")
        }
    }
}

func runECDSASigningDebugTest() {
    testECDSASigningMatchJS()
}
