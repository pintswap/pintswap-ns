import express from "express";
import { createLogger } from "@pintswap/sdk/lib/logger";
import { ethers } from "ethers";
import { hashOffer, Pintswap } from "@pintswap/sdk";
import { mkdirp } from "mkdirp";
import path from "path";
import bodyParser from "body-parser";
import url from "url";
import PeerId from "peer-id";
import fs from "fs-extra";
import pushable from "it-pushable";
import pipe from "it-pipe";
import { protocol } from "@pintswap/sdk/lib/protocol";
import * as lp from "it-length-prefixed";

class PintswapNameserver extends Pintswap {
  public registrar: any;
  public logger: ReturnType<typeof createLogger>;
  public tld: string;
  async handleQuery(connection: any) {
    const { stream } = connection;
    const messages = pushable();
    const it = pipe(stream.source, lp.decode());
    const name = protocol.NameQuery.decode((await it.next()).value.slice());
    const lookup = this.registrar.get(name[name.data]);
    if (!lookup) messages.push(protocol.NameQueryResponse.encode({
      status: 0,
      result: ''
    }).finish());
    else messages.push(protocol.NameQueryResponse.encode({
      status: 1,
      result: lookup
    }).finish());
    messages.end();
    await pipe(messages, lp.encode(), stream.sink);
  }
  constructor(o: any) {
    super(o);
    this.registrar = new Map();
    this.logger = o.logger || logger;
    this.tld = o.tld || "drip";
  }
  async registerNameserverHandlers() {
    await this.handle("/pintswap/0.1.0/ns/query", this.handleQuery.bind(this));
    await this.handle(
      "/pintswap/0.1.0/ns/register",
      this.handleRegister.bind(this)
    );
    this.logger.info("registered nameserver handlers");
  }
  async startNode() {
    await super.startNode();
    await this.registerNameserverHandlers();
  }
  addTld(s) {
    return s + "." + this.tld;
  }
  stripTld(s) {
    return s.replace(RegExp("\\." + this.tld + "$", "g"), "");
  }
  async handleRegister(incoming: any) {
    const {
      stream,
      connection: { remotePeer },
    } = incoming;
    const messages = pushable();
    pipe(messages, lp.encode(), stream.sink);
    const it = pipe(stream.source, lp.decode());
    const name = (await it.next()).value.slice().toString();
    const lookup = this.registrar.get(name);
    const remotePeerId = remotePeer.toB58String();
    if (lookup && lookup.toString() !== remotePeerId) {
      messages.push(
        protocol.NameRegisterResponse.encode({
          status: "NAMEREG_NO",
        }).finish()
      );
    } else {
      this.registrar.set(name, remotePeerId);
      this.registrar.set(remotePeerId, name);
      await saveRegistrar(this);
      messages.push(
        protocol.NameRegisterResponse.encode({
          status: "NAMEREG_OK",
        }).finish()
      );
    }
    messages.end();
  }
}

export function providerFromChainId(chainId) {
  switch (Number(chainId)) {
    case 1:
      return new ethers.InfuraProvider("mainnet");
    case 42161:
      return new ethers.InfuraProvider("arbitrum");
    case 10:
      return new ethers.InfuraProvider("optimism");
    case 137:
      return new ethers.InfuraProvider("polygon");
  }
  throw Error("chainid " + chainId + " not supported");
}

export const logger: any = createLogger("pintswap-ns");

export function walletFromEnv() {
  const WALLET = process.env.PINTSWAP_REGISTRAR_WALLET;
  if (!WALLET) {
    logger.warn("no WALLET defined, generating random wallet as fallback");
    return ethers.Wallet.createRandom();
  }
  return new ethers.Wallet(WALLET);
}

export function providerFromEnv() {
  const chainId = Number(process.env.PINTSWAP_REGISTRAR_CHAINID || 1);
  return providerFromChainId(chainId);
}

export const PINTSWAP_DIRECTORY = path.join(process.env.HOME, ".pintswap-ns");

export const PINTSWAP_PEERID_FILEPATH = path.join(
  PINTSWAP_DIRECTORY,
  "peer-id.json"
);

export async function loadOrCreatePeerId() {
  await mkdirp(PINTSWAP_DIRECTORY);
  if (await fs.exists(PINTSWAP_PEERID_FILEPATH)) {
    return await PeerId.createFromJSON(
      JSON.parse(await fs.readFile(PINTSWAP_PEERID_FILEPATH, "utf8"))
    );
  }
  logger.info("generating PeerId ...");
  const peerId = await PeerId.create();
  await fs.writeFile(
    PINTSWAP_PEERID_FILEPATH,
    JSON.stringify(peerId.toJSON(), null, 2)
  );
  return peerId;
}

export async function runServer(app: ReturnType<typeof express>) {
  const hostname = process.env.PINTSWAP_REGISTRAR_HOST || "127.0.0.1";
  const port = process.env.PINTSWAP_REGISTRAR_PORT || 42162;
  const uri = hostname + ":" + port;
  await new Promise<void>((resolve, reject) => {
    app.listen(port, hostname, (err) => (err ? reject(err) : resolve()));
  });
  logger.info("daemon bound to " + uri);
}

export const PINTSWAP_REGISTRAR_FILEPATH = path.join(
  PINTSWAP_DIRECTORY,
  "registrar.json"
);
export async function saveRegistrar(pintswap) {
  await mkdirp(PINTSWAP_DIRECTORY);
  const entries = [...pintswap.registrar.entries()];
  await fs.writeFile(
    PINTSWAP_REGISTRAR_FILEPATH,
    JSON.stringify(entries, null, 2)
  );
}

export async function loadRegistrar() {
  await mkdirp(PINTSWAP_DIRECTORY);
  const exists = await fs.exists(PINTSWAP_REGISTRAR_FILEPATH);
  if (exists)
    return new Map(
      JSON.parse(await fs.readFile(PINTSWAP_REGISTRAR_FILEPATH, "utf8"))
    );
  else return new Map();
}

export async function run() {
  const wallet = walletFromEnv().connect(providerFromEnv());
  const rpc = express();
  const peerId = await loadOrCreatePeerId();
  logger.info("using wallet: " + wallet.address);
  const pintswap = new PintswapNameserver({
    signer: wallet,
    peerId,
  });
  pintswap.registrar = await loadRegistrar();
  await pintswap.startNode();
  logger.info("connected to pintp2p");
  logger.info("using multiaddr: " + peerId.toB58String());

  logger.info("registered protocol handlers");
  pintswap.on("peer:discovery", (peer) => {
    logger.info("discovered peer: " + peer.toB58String());
  });
  await runServer(rpc);
}
