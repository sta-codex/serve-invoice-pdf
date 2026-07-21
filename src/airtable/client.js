import { FACTURA_FIELD_IDS, EXISTENCIA_FIELD_IDS } from "./fields.js";

const AIRTABLE_API_URL = "https://api.airtable.com/v0";

export class AirtableClient {
  constructor({ token, baseId }) {
    if (!token) {
      throw new Error("Missing AIRTABLE_TOKEN");
    }
    this.token = token;
    this.baseId = baseId;
  }

  async getRecord(tableId, recordId) {
    const url = this.#url(`${tableId}/${recordId}`, {
      returnFieldsByFieldId: "true"
    });
    return this.#fetchJson(url);
  }

  async findInvoiceByNumber(tableId, invoiceNumber) {
    const formula = `{ID} = '${escapeFormulaString(invoiceNumber)}'`;
    const records = await this.#listRecords(tableId, {
      filterByFormula: formula,
      fields: FACTURA_FIELD_IDS,
      pageSize: 1
    });
    return records[0] || null;
  }

  async listExistenciasByIds(tableId, recordIds) {
    if (!recordIds.length) {
      return [];
    }

    const records = [];
    for (const ids of chunks(recordIds, 40)) {
      const filterByFormula = `OR(${ids
        .map((id) => `RECORD_ID()='${escapeFormulaString(id)}'`)
        .join(",")})`;
      const page = await this.#listRecords(tableId, {
        filterByFormula,
        fields: EXISTENCIA_FIELD_IDS,
        pageSize: 100
      });
      records.push(...page);
    }

    const byId = new Map(records.map((record) => [record.id, record]));
    return recordIds.map((id) => byId.get(id)).filter(Boolean);
  }

  async listRecordsByIds(tableId, recordIds, fieldIds = []) {
    if (!recordIds.length) {
      return [];
    }

    const records = [];
    for (const ids of chunks([...new Set(recordIds)], 40)) {
      const filterByFormula = `OR(${ids
        .map((id) => `RECORD_ID()='${escapeFormulaString(id)}'`)
        .join(",")})`;
      records.push(
        ...(await this.#listRecords(tableId, {
          filterByFormula,
          fields: fieldIds,
          pageSize: 100
        }))
      );
    }
    return records;
  }

  async listRecordsByIdsWithFieldNames(tableId, recordIds, fieldNames = []) {
    if (!recordIds.length) {
      return [];
    }

    const records = [];
    for (const ids of chunks([...new Set(recordIds)], 40)) {
      const filterByFormula = `OR(${ids
        .map((id) => `RECORD_ID()='${escapeFormulaString(id)}'`)
        .join(",")})`;
      records.push(
        ...(await this.#listRecords(tableId, {
          filterByFormula,
          fields: fieldNames,
          pageSize: 100,
          returnFieldsByFieldId: false
        }))
      );
    }
    return records;
  }

  async listRecords(tableId, { fields = [], filterByFormula, pageSize = 100 } = {}) {
    return this.#listRecords(tableId, {
      fields,
      filterByFormula,
      pageSize
    });
  }

  async #listRecords(tableId, body) {
    const records = [];
    let offset;
    const { returnFieldsByFieldId = true, ...requestBody } = body;

    do {
      const response = await this.#fetchJson(
        this.#url(`${tableId}/listRecords`),
        {
          method: "POST",
          body: JSON.stringify({
            ...requestBody,
            offset,
            returnFieldsByFieldId
          })
        }
      );
      records.push(...(response.records || []));
      offset = response.offset;
    } while (offset);

    return records;
  }

  #url(path, params = {}) {
    const url = new URL(`${AIRTABLE_API_URL}/${this.baseId}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  async #fetchJson(url, init = {}) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.headers || {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Airtable ${response.status}: ${text}`);
    }

    return response.json();
  }
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
}

function escapeFormulaString(value) {
  return String(value).replace(/'/g, "\\'");
}
