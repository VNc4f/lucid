import { C, Core } from "../core/mod.ts";
import { applyDoubleCborEncoding, fromHex, toHex } from "../utils/mod.ts";
import {
  Address,
  Assets,
  Credential,
  Datum,
  DatumHash,
  Delegation,
  OutRef,
  ProtocolParameters,
  Provider,
  RewardAddress,
  Transaction,
  TxHash,
  Txs,
  Unit,
  UTxO,
} from "../types/mod.ts";
import packageJson from "../../package.json" assert { type: "json" };

export class Blockfrost implements Provider {
  url: string;
  projectId: string;

  constructor(url: string, projectId?: string) {
    this.url = url;
    this.projectId = projectId || "";
  }

  async getProtocolParameters(): Promise<ProtocolParameters> {
    const result = await fetch(`${this.url}/epochs/latest/parameters`, {
      headers: { project_id: this.projectId, lucid },
    }).then((res) => res.json());

    return {
      minFeeA: parseInt(result.min_fee_a),
      minFeeB: parseInt(result.min_fee_b),
      maxTxSize: parseInt(result.max_tx_size),
      maxValSize: parseInt(result.max_val_size),
      keyDeposit: BigInt(result.key_deposit),
      poolDeposit: BigInt(result.pool_deposit),
      priceMem: parseFloat(result.price_mem),
      priceStep: parseFloat(result.price_step),
      maxTxExMem: BigInt(result.max_tx_ex_mem),
      maxTxExSteps: BigInt(result.max_tx_ex_steps),
      coinsPerUtxoByte: BigInt(result.coins_per_utxo_size),
      collateralPercentage: parseInt(result.collateral_percent),
      maxCollateralInputs: parseInt(result.max_collateral_inputs),
      costModels: result.cost_models,
    };
  }

  getQueryPredicate(addressOrCredential: Address | Credential): string {
    if (typeof addressOrCredential === "string") return addressOrCredential;

    return addressOrCredential.type === "Key"
      ? C.Ed25519KeyHash.from_hex(addressOrCredential.hash).to_bech32(
        "addr_vkh",
      )
      : C.ScriptHash.from_hex(addressOrCredential.hash).to_bech32("addr_vkh"); // should be 'script' (CIP-0005)
  }

  async fetchPageBlockfrost<T>(
    url: string,
    order?: "asc" | "desc",
    toPage?: number,
  ): Promise<Array<T>> {
    if (typeof order == "undefined") order = "asc";
    let result: Array<T> = [];
    let page = 1;
    while (true) {
      const pageResult: Array<T> | BlockfrostUtxoError = await fetch(
        `${url}&order=${order}&page=${page}`,
        { headers: { project_id: this.projectId, lucid } },
      ).then((res) => res.json());
      if ((pageResult as BlockfrostUtxoError).error) {
        if ((pageResult as BlockfrostUtxoError).status_code === 404) {
          return [];
        } else {
          throw new Error("Could not fetch UTxOs from Blockfrost. Try again.");
        }
      }
      result = result.concat(pageResult as Array<T>);
      if ((pageResult as Array<T>).length <= 0 || page == toPage) break;
      page++;
    }

    return result;
  }

  async getUtxos(addressOrCredential: Address | Credential): Promise<UTxO[]> {
    return this.blockfrostUtxosToUtxos(
      await this.fetchPageBlockfrost<BlockfrostUtxoResult>(
        `${this.url}/addresses/${
          this.getQueryPredicate(addressOrCredential)
        }/utxos?`,
      ),
    );
  }

  async getUtxosWithUnit(
    addressOrCredential: Address | Credential,
    unit: Unit,
  ): Promise<UTxO[]> {
    return this.blockfrostUtxosToUtxos(
      await this.fetchPageBlockfrost<BlockfrostUtxoResult>(
        `${this.url}/addresses/${
          this.getQueryPredicate(addressOrCredential)
        }/utxos/${unit}?`,
      ),
    );
  }

  async getTxsByUnit(
    unit: Unit,
    order?: "asc" | "desc",
    toPage?: number,
  ): Promise<Array<BlockfrostAssetTxsResult>> {
    return await this.fetchPageBlockfrost<BlockfrostAssetTxsResult>(
      `${this.url}/assets/${unit}/transactions?`,
      order,
      toPage,
    );
  }

  async getUtxosMintByUnit(unit: Unit): Promise<UTxO[]> {
    const results: Array<BlockfrostAssetTxsResult> = await this.getTxsByUnit(
      unit,
      "asc",
      1,
    );
    if (results.length <= 0) return [];

    return await this.getUtxosByHash(results[0].tx_hash);
  }

  async getUtxosByUnit(unit: Unit): Promise<UTxO[]> {
    const results: Array<BlockfrostAssetTxsResult> = await this.getTxsByUnit(
      unit,
    );
    const txHashes = [...new Set(results.map((assetTx) => assetTx.tx_hash))];
    // deno-lint-ignore no-this-alias
    const that = this;
    const utxos = await Promise.all(txHashes.map(function (v, _i, _a) {
      return that.getUtxosByHash(v);
    }));

    return utxos.reduce((acc, utxos) => acc.concat(utxos), []);
  }

  async getUtxoByUnit(unit: Unit): Promise<UTxO> {
    const addresses = await fetch(
      `${this.url}/assets/${unit}/addresses?count=2`,
      { headers: { project_id: this.projectId, lucid } },
    ).then((res) => res.json());

    if (!addresses || addresses.error) {
      throw new Error("Unit not found.");
    }
    if (addresses.length > 1) {
      throw new Error("Unit needs to be an NFT or only held by one address.");
    }

    const address = addresses[0].address;

    const utxos = await this.getUtxosWithUnit(address, unit);

    if (utxos.length > 1) {
      throw new Error("Unit needs to be an NFT or only held by one address.");
    }

    return utxos[0];
  }

  async getUtxosByOutRef(outRefs: OutRef[]): Promise<UTxO[]> {
    const queryHashes = [...new Set(outRefs.map((outRef) => outRef.txHash))];
    const utxos = await Promise.all(queryHashes.map(this.getUtxosByHash));

    return utxos.reduce((acc, utxos) => acc.concat(utxos), []).filter((utxo) =>
      outRefs.some((outRef) =>
        utxo.txHash === outRef.txHash && utxo.outputIndex === outRef.outputIndex
      )
    );
  }

  async getUtxosByHash(txHash: TxHash): Promise<UTxO[]> {
    const result = await fetch(
      `${this.url}/txs/${txHash}/utxos`,
      { headers: { project_id: this.projectId, lucid } },
    ).then((res) => res.json());
    if (!result || result.error) {
      return [];
    }
    const utxosResult: BlockfrostUtxoResult[] = result.outputs.map((
      // deno-lint-ignore no-explicit-any
      r: any,
    ) => ({
      ...r,
      tx_hash: txHash,
    }));

    return this.blockfrostUtxosToUtxos(utxosResult);
  }

  async getTxsByHash(txHash: TxHash): Promise<Txs> {
    const result = await fetch(
      `${this.url}/txs/${txHash}`,
      { headers: { project_id: this.projectId, lucid } },
    ).then((res) => res.json());
    if (!result || result.error) {
      throw new Error(result.error + ": " + result.message);
    }
    const r: BlockfrostTxsResult = result;

    return {
      txHash: r.tx_hash,
      block: r.block,
      blockHeight: r.block_height,
      blockTime: r.block_time,
      slot: r.slot,
      index: r.index,
      outputAmount: (() => {
        const a: Assets = {};
        r.output_amount.forEach((am) => {
          a[am.unit] = BigInt(am.quantity);
        });
        return a;
      })(),
      fees: BigInt(r.fees),
      deposit: BigInt(r.deposit),
      size: r.size,
      invalidBefore: !r.invalid_before ? r.invalid_before : undefined,
      invalidHereafter: !r.invalid_hereafter ? r.invalid_hereafter : undefined,
      utxoCount: r.utxo_count,
      withdrawalCount: r.withdrawal_count,
      mirCertCount: r.mir_cert_count,
      delegationCount: r.delegation_count,
      stakeCertCount: r.stake_cert_count,
      poolUpdateCount: r.pool_update_count,
      poolRetireCount: r.pool_retire_count,
      assetMintOrBurnCount: r.asset_mint_or_burn_count,
      redeemerCount: r.redeemer_count,
      validContract: r.valid_contract,
    };
  }

  async getDelegation(rewardAddress: RewardAddress): Promise<Delegation> {
    const result = await fetch(
      `${this.url}/accounts/${rewardAddress}`,
      { headers: { project_id: this.projectId, lucid } },
    ).then((res) => res.json());
    if (!result || result.error) {
      return { poolId: null, rewards: 0n };
    }
    return {
      poolId: result.pool_id || null,
      rewards: BigInt(result.withdrawable_amount),
    };
  }

  async getDatum(datumHash: DatumHash): Promise<Datum> {
    const datum = await fetch(
      `${this.url}/scripts/datum/${datumHash}/cbor`,
      {
        headers: { project_id: this.projectId, lucid },
      },
    )
      .then((res) => res.json())
      .then((res) => res.cbor);
    if (!datum || datum.error) {
      throw new Error(`No datum found for datum hash: ${datumHash}`);
    }
    return datum;
  }

  async getDatumJson(datumHash: DatumHash): Promise<unknown> {
    const datum = await fetch(
      `${this.url}/scripts/datum/${datumHash}`,
      {
        headers: { project_id: this.projectId, lucid },
      },
    ).then((res) => res.json());
    if (!datum || datum.error) {
      throw new Error(`No datum found for datum hash: ${datumHash}`);
    }
    return datum;
  }

  awaitTx(txHash: TxHash, checkInterval = 3000): Promise<boolean> {
    return new Promise((res) => {
      const confirmation = setInterval(async () => {
        const isConfirmed = await fetch(`${this.url}/txs/${txHash}`, {
          headers: { project_id: this.projectId, lucid },
        }).then((res) => res.json());
        if (isConfirmed && !isConfirmed.error) {
          clearInterval(confirmation);
          res(true);
          return;
        }
      }, checkInterval);
    });
  }

  async submitTx(tx: Transaction): Promise<TxHash> {
    const result = await fetch(`${this.url}/tx/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/cbor",
        project_id: this.projectId,
        lucid,
      },
      body: fromHex(tx),
    }).then((res) => res.json());
    if (!result || result.error) {
      if (result?.status_code === 400) throw new Error(result.message);
      else throw new Error("Could not submit transaction.");
    }
    return result;
  }

  private async blockfrostUtxosToUtxos(
    result: Array<BlockfrostUtxoResult>,
  ): Promise<UTxO[]> {
    return (await Promise.all(
      result.map(async (r) => ({
        txHash: r.tx_hash,
        outputIndex: r.output_index,
        assets: (() => {
          const a: Assets = {};
          r.amount.forEach((am) => {
            a[am.unit] = BigInt(am.quantity);
          });
          return a;
        })(),
        address: r.address,
        datumHash: !r.inline_datum ? r.data_hash : undefined,
        datum: r.inline_datum,
        scriptRef: r.reference_script_hash &&
          (await (async () => {
            const {
              type,
            } = await fetch(
              `${this.url}/scripts/${r.reference_script_hash}`,
              {
                headers: { project_id: this.projectId, lucid },
              },
            ).then((res) => res.json());
            // TODO: support native scripts
            if (type === "Native" || type === "native") {
              throw new Error("Native script ref not implemented!");
            }
            const { cbor: script } = await fetch(
              `${this.url}/scripts/${r.reference_script_hash}/cbor`,
              { headers: { project_id: this.projectId, lucid } },
            ).then((res) => res.json());
            return {
              type: type === "plutusV1" ? "PlutusV1" : "PlutusV2",
              script: applyDoubleCborEncoding(script),
            };
          })()),
      })),
    )) as UTxO[];
  }
}

/**
 * This function is temporarily needed only, until Blockfrost returns the datum natively in Cbor.
 * The conversion is ambigious, that's why it's better to get the datum directly in Cbor.
 */
export function datumJsonToCbor(json: DatumJson): Datum {
  const convert = (json: DatumJson): Core.PlutusData => {
    if (!isNaN(json.int!)) {
      return C.PlutusData.new_integer(C.BigInt.from_str(json.int!.toString()));
    } else if (json.bytes || !isNaN(Number(json.bytes))) {
      return C.PlutusData.new_bytes(fromHex(json.bytes!));
    } else if (json.map) {
      const m = C.PlutusMap.new();
      json.map.forEach(({ k, v }: { k: unknown; v: unknown }) => {
        m.insert(convert(k as DatumJson), convert(v as DatumJson));
      });
      return C.PlutusData.new_map(m);
    } else if (json.list) {
      const l = C.PlutusList.new();
      json.list.forEach((v: DatumJson) => {
        l.add(convert(v));
      });
      return C.PlutusData.new_list(l);
    } else if (!isNaN(json.constructor! as unknown as number)) {
      const l = C.PlutusList.new();
      json.fields!.forEach((v: DatumJson) => {
        l.add(convert(v));
      });
      return C.PlutusData.new_constr_plutus_data(
        C.ConstrPlutusData.new(
          C.BigNum.from_str(json.constructor!.toString()),
          l,
        ),
      );
    }
    throw new Error("Unsupported type");
  };

  return toHex(convert(json).to_bytes());
}

type DatumJson = {
  int?: number;
  bytes?: string;
  list?: Array<DatumJson>;
  map?: Array<{ k: unknown; v: unknown }>;
  fields?: Array<DatumJson>;
  [constructor: string]: unknown; // number; constructor needs to be simulated like this as optional argument
};

type BlockfrostUtxoResult = {
  tx_hash: string;
  output_index: number;
  address: Address;
  amount: Array<{ unit: string; quantity: string }>;
  data_hash?: string;
  inline_datum?: string;
  reference_script_hash?: string;
};

type BlockfrostAssetTxsResult = {
  tx_hash: string;
  tx_index: number;
  block_height: number;
  block_time: number;
};

type BlockfrostUtxoError = {
  status_code: number;
  error: unknown;
};

type BlockfrostTxsResult = {
  tx_hash: string;
  block: string;
  block_height: number;
  block_time: number;
  slot: number;
  index: number;
  output_amount: Array<{ unit: string; quantity: string }>;
  fees: string;
  deposit: string;
  size: number;
  invalid_before?: string;
  invalid_hereafter?: string;
  utxo_count: number;
  withdrawal_count: number;
  mir_cert_count: number;
  delegation_count: number;
  stake_cert_count: number;
  pool_update_count: number;
  pool_retire_count: number;
  asset_mint_or_burn_count: number;
  redeemer_count: number;
  valid_contract: boolean;
};

const lucid = packageJson.version; // Lucid version
