"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.loadRegistrar = exports.saveRegistrar = exports.PINTSWAP_REGISTRAR_FILEPATH = exports.runServer = exports.loadOrCreatePeerId = exports.PINTSWAP_PEERID_FILEPATH = exports.PINTSWAP_DIRECTORY = exports.providerFromEnv = exports.walletFromEnv = exports.logger = exports.providerFromChainId = void 0;
const express_1 = __importDefault(require("express"));
const logger_1 = require("@pintswap/sdk/lib/logger");
const ethers_1 = require("ethers");
const sdk_1 = require("@pintswap/sdk");
const mkdirp_1 = require("mkdirp");
const path_1 = __importDefault(require("path"));
const peer_id_1 = __importDefault(require("peer-id"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const it_pushable_1 = __importDefault(require("it-pushable"));
const it_pipe_1 = __importDefault(require("it-pipe"));
const protocol_1 = require("@pintswap/sdk/lib/protocol");
const lp = __importStar(require("it-length-prefixed"));
class PintswapNameserver extends sdk_1.Pintswap {
    handleQuery(connection) {
        return __awaiter(this, void 0, void 0, function* () {
            const { stream } = connection;
            const messages = (0, it_pushable_1.default)();
            const it = (0, it_pipe_1.default)(stream.source, lp.decode());
            const name = protocol_1.protocol.NameQuery.decode((yield it.next()).value.slice());
            const lookup = this.registrar.get(name[name.data]);
            if (!lookup)
                messages.push(protocol_1.protocol.NameQueryResponse.encode({
                    status: 0,
                    result: ''
                }).finish());
            else
                messages.push(protocol_1.protocol.NameQueryResponse.encode({
                    status: 1,
                    result: lookup
                }).finish());
            messages.end();
            yield (0, it_pipe_1.default)(messages, lp.encode(), stream.sink);
        });
    }
    constructor(o) {
        super(o);
        this.registrar = new Map();
        this.logger = o.logger || exports.logger;
        this.tld = o.tld || "drip";
    }
    registerNameserverHandlers() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.handle("/pintswap/0.1.0/ns/query", this.handleQuery.bind(this));
            yield this.handle("/pintswap/0.1.0/ns/register", this.handleRegister.bind(this));
            this.logger.info("registered nameserver handlers");
        });
    }
    startNode() {
        const _super = Object.create(null, {
            startNode: { get: () => super.startNode }
        });
        return __awaiter(this, void 0, void 0, function* () {
            yield _super.startNode.call(this);
            yield this.registerNameserverHandlers();
        });
    }
    addTld(s) {
        return s + "." + this.tld;
    }
    stripTld(s) {
        return s.replace(RegExp("\\." + this.tld + "$", "g"), "");
    }
    handleRegister(incoming) {
        return __awaiter(this, void 0, void 0, function* () {
            const { stream, connection: { remotePeer }, } = incoming;
            const messages = (0, it_pushable_1.default)();
            (0, it_pipe_1.default)(messages, lp.encode(), stream.sink);
            const it = (0, it_pipe_1.default)(stream.source, lp.decode());
            const name = (yield it.next()).value.slice().toString();
            const lookup = this.registrar.get(name);
            const remotePeerId = remotePeer.toB58String();
            if (lookup && lookup.toString() !== remotePeerId) {
                messages.push(protocol_1.protocol.NameRegisterResponse.encode({
                    status: "NAMEREG_NO",
                }).finish());
            }
            else {
                this.registrar.set(name, remotePeerId);
                this.registrar.set(remotePeerId, name);
                yield saveRegistrar(this);
                messages.push(protocol_1.protocol.NameRegisterResponse.encode({
                    status: "NAMEREG_OK",
                }).finish());
            }
            messages.end();
        });
    }
}
function providerFromChainId(chainId) {
    switch (Number(chainId)) {
        case 1:
            return new ethers_1.ethers.InfuraProvider("mainnet");
        case 42161:
            return new ethers_1.ethers.InfuraProvider("arbitrum");
        case 10:
            return new ethers_1.ethers.InfuraProvider("optimism");
        case 137:
            return new ethers_1.ethers.InfuraProvider("polygon");
    }
    throw Error("chainid " + chainId + " not supported");
}
exports.providerFromChainId = providerFromChainId;
exports.logger = (0, logger_1.createLogger)("pintswap-ns");
function walletFromEnv() {
    const WALLET = process.env.PINTSWAP_REGISTRAR_WALLET;
    if (!WALLET) {
        exports.logger.warn("no WALLET defined, generating random wallet as fallback");
        return ethers_1.ethers.Wallet.createRandom();
    }
    return new ethers_1.ethers.Wallet(WALLET);
}
exports.walletFromEnv = walletFromEnv;
function providerFromEnv() {
    const chainId = Number(process.env.PINTSWAP_REGISTRAR_CHAINID || 1);
    return providerFromChainId(chainId);
}
exports.providerFromEnv = providerFromEnv;
exports.PINTSWAP_DIRECTORY = path_1.default.join(process.env.HOME, ".pintswap-ns");
exports.PINTSWAP_PEERID_FILEPATH = path_1.default.join(exports.PINTSWAP_DIRECTORY, "peer-id.json");
function loadOrCreatePeerId() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, mkdirp_1.mkdirp)(exports.PINTSWAP_DIRECTORY);
        if (yield fs_extra_1.default.exists(exports.PINTSWAP_PEERID_FILEPATH)) {
            return yield peer_id_1.default.createFromJSON(JSON.parse(yield fs_extra_1.default.readFile(exports.PINTSWAP_PEERID_FILEPATH, "utf8")));
        }
        exports.logger.info("generating PeerId ...");
        const peerId = yield peer_id_1.default.create();
        yield fs_extra_1.default.writeFile(exports.PINTSWAP_PEERID_FILEPATH, JSON.stringify(peerId.toJSON(), null, 2));
        return peerId;
    });
}
exports.loadOrCreatePeerId = loadOrCreatePeerId;
function runServer(app) {
    return __awaiter(this, void 0, void 0, function* () {
        const hostname = process.env.PINTSWAP_REGISTRAR_HOST || "127.0.0.1";
        const port = process.env.PINTSWAP_REGISTRAR_PORT || 42162;
        const uri = hostname + ":" + port;
        yield new Promise((resolve, reject) => {
            app.listen(port, hostname, (err) => (err ? reject(err) : resolve()));
        });
        exports.logger.info("daemon bound to " + uri);
    });
}
exports.runServer = runServer;
exports.PINTSWAP_REGISTRAR_FILEPATH = path_1.default.join(exports.PINTSWAP_DIRECTORY, "registrar.json");
function saveRegistrar(pintswap) {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, mkdirp_1.mkdirp)(exports.PINTSWAP_DIRECTORY);
        const entries = [...pintswap.registrar.entries()];
        yield fs_extra_1.default.writeFile(exports.PINTSWAP_REGISTRAR_FILEPATH, JSON.stringify(entries, null, 2));
    });
}
exports.saveRegistrar = saveRegistrar;
function loadRegistrar() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, mkdirp_1.mkdirp)(exports.PINTSWAP_DIRECTORY);
        const exists = yield fs_extra_1.default.exists(exports.PINTSWAP_REGISTRAR_FILEPATH);
        if (exists)
            return new Map(JSON.parse(yield fs_extra_1.default.readFile(exports.PINTSWAP_REGISTRAR_FILEPATH, "utf8")));
        else
            return new Map();
    });
}
exports.loadRegistrar = loadRegistrar;
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const wallet = walletFromEnv().connect(providerFromEnv());
        const rpc = (0, express_1.default)();
        const peerId = yield loadOrCreatePeerId();
        exports.logger.info("using wallet: " + wallet.address);
        const pintswap = new PintswapNameserver({
            signer: wallet,
            peerId,
        });
        pintswap.registrar = yield loadRegistrar();
        yield pintswap.startNode();
        exports.logger.info("connected to pintp2p");
        exports.logger.info("using multiaddr: " + peerId.toB58String());
        exports.logger.info("registered protocol handlers");
        pintswap.on("peer:discovery", (peer) => {
            exports.logger.info("discovered peer: " + peer.toB58String());
        });
        yield runServer(rpc);
    });
}
exports.run = run;
//# sourceMappingURL=ns.js.map