import Foundation
import CommonCrypto

func deepHash(_ data: Any) throws -> Data {
    if let array = data as? [Data] {
        let tag = try concatBuffers([
            "list".data(using: .utf8)!,
            String(array.count).data(using: .utf8)!
        ])
        return try deepHashChunks(array, sha384(tag))
    }
    
    if let data = data as? Data {
        let tag = try concatBuffers([
            "blob".data(using: .utf8)!,
            String(data.count).data(using: .utf8)!
        ])
        let taggedHash = try concatBuffers([
            sha384(tag),
            sha384(data)
        ])
        return sha384(taggedHash)
    }
    
    throw NSError(domain: "Invalid data type", code: 1, userInfo: nil)
}

func deepHashChunks(_ chunks: [Data], _ acc: Data) throws -> Data {
    if chunks.isEmpty {
        return acc
    }
    let hashPair = try concatBuffers([
        acc,
        try deepHash(chunks[0])
    ])
    let newAcc = sha384(hashPair)
    return try deepHashChunks(Array(chunks.dropFirst()), newAcc)
}

func deepHashData(_ data: Any) throws -> Data {
    if let array = data as? [Any] {
        print("=== Swift DeepHash Array Processing ===")
        print("Array length: \(array.count)")
        
        let tag = try concatBuffers([
            "list".data(using: .utf8)!,
            String(array.count).data(using: .utf8)!
        ])
        print("List tag hex: \(tag.map { String(format: "%02x", $0) }.joined())")
        
        let tagHash = sha384(tag)
        print("Tag hash hex: \(tagHash.map { String(format: "%02x", $0) }.joined())")
        
        var hashes: [Data] = []
        for (i, element) in array.enumerated() {
            let elementHash = try deepHashData(element)
            print("Element \(i) hash: \(elementHash.map { String(format: "%02x", $0) }.joined())")
            hashes.append(elementHash)
        }
        let result = try deepHashDataChunks(hashes, tagHash)
        print("Final deepHash result hex: \(result.map { String(format: "%02x", $0) }.joined())")
        print("===============================")
        return result
    }
    
    if let data = data as? Data {
        print("=== Swift DeepHash Blob Processing ===")
        print("Data length: \(data.count)")
        print("Data hex: \(data.map { String(format: "%02x", $0) }.joined())")
        
        let tag = try concatBuffers([
            "blob".data(using: .utf8)!,
            String(data.count).data(using: .utf8)!
        ])
        print("Blob tag hex: \(tag.map { String(format: "%02x", $0) }.joined())")
        
        let tagHash = sha384(tag)
        print("Tag hash hex: \(tagHash.map { String(format: "%02x", $0) }.joined())")
        
        let dataHash = sha384(data)
        print("Data hash hex: \(dataHash.map { String(format: "%02x", $0) }.joined())")
        
        let taggedHash = try concatBuffers([
            tagHash,
            dataHash
        ])
        print("Tagged hash hex: \(taggedHash.map { String(format: "%02x", $0) }.joined())")
        
        let result = sha384(taggedHash)
        print("Final hash result hex: \(result.map { String(format: "%02x", $0) }.joined())")
        print("===============================")
        return result
    }
    
    throw NSError(domain: "Invalid data type", code: 1, userInfo: nil)
}

func deepHashDataChunks(_ chunks: [Data], _ acc: Data) throws -> Data {
    print("=== Swift DeepHash Chunks Processing ===")
    print("Chunks remaining: \(chunks.count)")
    print("Accumulator hex: \(acc.map { String(format: "%02x", $0) }.joined())")
    
    if chunks.isEmpty {
        print("No more chunks, returning accumulator")
        return acc
    }
    
    print("Processing chunk 0 hex: \(chunks[0].map { String(format: "%02x", $0) }.joined())")
    let hashPair = try concatBuffers([
        acc,
        chunks[0]
    ])
    print("Hash pair hex: \(hashPair.map { String(format: "%02x", $0) }.joined())")
    
    let newAcc = sha384(hashPair)
    print("New accumulator hex: \(newAcc.map { String(format: "%02x", $0) }.joined())")
    
    return try deepHashDataChunks(Array(chunks.dropFirst()), newAcc)
}

func sha384(_ data: Data) -> Data {
    var hash = [UInt8](repeating: 0, count: Int(CC_SHA384_DIGEST_LENGTH))
    data.withUnsafeBytes {
        _ = CC_SHA384($0.baseAddress, CC_LONG(data.count), &hash)
    }
    return Data(hash)
}

func concatBuffers(_ buffers: [Data]) throws -> Data {
    var result = Data()
    for buffer in buffers {
        result.append(buffer)
    }
    return result
}
