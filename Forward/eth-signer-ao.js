const { EthereumSigner, createData } = require("@dha-team/arbundles");
const fetch = require("node-fetch");
const { result } = require("@permaweb/aoconnect");

const privateKey =
  "3afdfe893b2680adc1eda213dbc94ba07b7f923fcb42afe13956f7ac7f619344";

const AO_ENDPOINT = "https://mu.ao-testnet.xyz/";
// Original test process is no longer whitelisted on MU (Feb 22 2026 whitelist update)
// Using ARIO token process which is whitelisted
const TARGET_PROCESS = "qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE";

async function main() {
  try {
    const signer = new EthereumSigner(privateKey);
    console.log("Signer public key:", signer.publicKey.toString("hex"));
    console.log("Signer public key length:", signer.publicKey.length);

    const tags = [
      { name: "Data-Protocol", value: "ao" },
      { name: "Variant", value: "ao.TN.1" },
      { name: "Type", value: "Message" },
      { name: "Action", value: "Balance" },
    ];

    const anchor = Math.round(Date.now() / 1000)
      .toString()
      .padStart(32, Math.floor(Math.random() * 10).toString());
    console.log("Target process:", TARGET_PROCESS);

    const dataItem = createData("", signer, {
      tags,
      target: TARGET_PROCESS,
      anchor,
    });

    await dataItem.sign(signer);

    console.log("\n=== POST-SIGNING RESULTS ===");
    console.log("Signed data item created");
    console.log("Data Item ID:", dataItem.id);
    console.log("Final signature hex:", dataItem.signature);

    console.log("\n=== SENDING TO AO ===");
    const response = await fetch(AO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        Accept: "application/json",
      },
      body: dataItem.getRaw(),
    });

    const resText = await response.text();
    console.log("Response status:", response.status);
    console.log("Response body:", resText);

    let res;
    try {
      res = JSON.parse(resText);
    } catch {
      res = {};
    }
    let id = res.id;

    if (id) {
      console.log("Message sent successfully:", id);

      let { Messages, Error } = await result({
        message: id,
        process: TARGET_PROCESS,
      });

      if (Messages.length > 0) {
        const message = Messages[0];
        if (message.Tags && message.Tags.length > 0) {
          const ownerTag = message.Tags.find((tag) => tag.name === "Owner");
          if (ownerTag) {
            console.log("\n=== OWNER ===");
            console.log("Owner:", ownerTag.value);
          } else {
            console.log("Owner tag not found in message tags");
          }
        } else {
          console.log("No tags found in message");
        }
      } else {
        throw new Error("Message not received");
      }
    } else {
      throw new Error("Message not sent");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);
