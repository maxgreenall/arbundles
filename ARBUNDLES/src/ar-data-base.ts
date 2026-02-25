import type DataItem from "./DataItem";
import { deepHash, stringToBuffer } from "$/utils";
/**
 * Options for creation of a DataItem
 */
export interface DataItemCreateOptions {
  target?: string;
  anchor?: string;
  tags?: { name: string; value: string }[];
}

async function getSignatureData(item: DataItem): Promise<Uint8Array> {
  // Debug prints for comparison with Swift
  console.log("=== JavaScript DataItem Debug Info ===");
  console.log("signatureType:", item.signatureType);
  console.log("rawOwner length:", item.rawOwner.length);
  console.log("rawOwner hex:", Buffer.from(item.rawOwner).toString('hex'));
  console.log("rawTarget length:", item.rawTarget.length);
  console.log("rawTarget hex:", Buffer.from(item.rawTarget).toString('hex'));
  console.log("rawAnchor length:", item.rawAnchor.length);
  console.log("rawAnchor hex:", Buffer.from(item.rawAnchor).toString('hex'));
  console.log("rawTags length:", item.rawTags.length);
  console.log("rawTags hex:", Buffer.from(item.rawTags).toString('hex'));
  console.log("rawData length:", item.rawData.length);
  console.log("rawData hex:", Buffer.from(item.rawData).toString('hex'));
  
  const messageToHash = [
    stringToBuffer("dataitem"),
    stringToBuffer("1"),
    stringToBuffer(item.signatureType.toString()),
    item.rawOwner,
    item.rawTarget,
    item.rawAnchor,
    item.rawTags,
    item.rawData,
  ];
  
  console.log("=== DeepHash Input Structure ===");
  messageToHash.forEach((element, index) => {
    const labels = ["dataitem", "1", "signatureType", "rawOwner", "rawTarget", "rawAnchor", "rawTags", "rawData"];
    console.log(`[${index}] ${labels[index]}:`, Buffer.from(element).toString('hex'));
  });
  
  const result = await deepHash(messageToHash);
  console.log("deepHash result hex:", Buffer.from(result).toString('hex'));
  console.log("===============================");
  
  return result;
}

export default getSignatureData;
