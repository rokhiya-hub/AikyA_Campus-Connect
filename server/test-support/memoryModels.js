const mongoose = require("mongoose");

// Persistence doubles only: documents still use the real schemas, validation,
// setters, serialization and faculty methods. No MongoDB server is contacted.
function memoryModel(name) {
  const Base = mongoose.model(name);
  const records = new Map();
  let writes = 0;
  const matches = (record, filter = {}) => Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((entry) => matches(record, entry));
    if (key === "$and") return value.every((entry) => matches(record, entry));
    if (value === null) return record[key] == null;
    if (value?.$elemMatch) return (record[key] || []).some(entry => matches(entry, value.$elemMatch));
    if (value && Object.hasOwn(value, "$ne")) return record[key] !== value.$ne;
    if (value && Object.hasOwn(value, "$exists")) return (record[key] !== undefined) === value.$exists;
    if (value && Object.hasOwn(value, "$gt")) return record[key] > value.$gt;
    if (value && Object.hasOwn(value, "$lte")) return record[key] <= value.$lte;
    if (value?.$in) return value.$in.some(entry => String(entry) === String(record[key]));
    if (value?.$regex !== undefined) {
      const flags = (value.$options || "") + (value.$regex.includes("\\p{") && !(value.$options || "").includes("u") ? "u" : "");
      const regex = new RegExp(value.$regex, flags);
      const values = (current, parts) => !parts.length ? (Array.isArray(current) ? current : [current]) : Array.isArray(current) ? current.flatMap(entry => values(entry, parts)) : values(current?.[parts[0]], parts.slice(1));
      return values(record, key.split(".")).some(entry => regex.test(entry || ""));
    }
    return String(record[key]) === String(value);
  });
  class Query {
    constructor(load) { this.load = load; this.offset = 0; this.cap = Infinity; }
    sort(spec) { this.order = spec; return this; }
    skip(value) { this.offset = value; return this; }
    limit(value) { this.cap = value; return this; }
    maxTimeMS(value) { this.timeout = value; return this; }
    select(value) { this.projection = value; return this; }
    session(value) { this.transactionSession = value; return this; }
    lean() { this.plain = true; return this; }
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        let result = this.load();
        if (Array.isArray(result)) {
          result = [...result];
          if (this.order) result.sort((a, b) => {
            for (const [key, direction] of Object.entries(this.order)) {
              if (String(a[key]) !== String(b[key])) return String(a[key]) > String(b[key]) ? direction : -direction;
            }
            return 0;
          });
          result = result.slice(this.offset, this.offset + this.cap);
        }
        const materialize = (raw) => {
          if (!raw) return null;
          const document = new MemoryModel(raw);
          return this.plain ? document.toObject({ transform: false, flattenMaps: true }) : document;
        };
        return Array.isArray(result) ? result.map(materialize) : materialize(result);
      }).then(resolve, reject);
    }
  }
  class MemoryModel extends Base {
    static async init() { return this; }
    static async listIndexes() { return this.schema.indexes().map(([key, options]) => ({ key, ...options })); }
    async save() {
      await this.validate();
      const raw = this.toObject({ transform: false, flattenMaps: true });
      records.set(String(this._id), raw);
      writes += 1;
      return this;
    }
    static async create(body) { return Array.isArray(body) ? Promise.all(body.map(row => new this(row).save())) : new this(body).save(); }
    static find(filter) { return new Query(() => [...records.values()].filter((row) => matches(row, filter))); }
    static findOne(filter) { return new Query(() => [...records.values()].find((row) => matches(row, filter))); }
    static findById(id) { return new Query(() => records.get(String(id))); }
    static async findByIdAndDelete(id) {
      const row = records.get(String(id));
      records.delete(String(id));
      writes += 1;
      return row ? new this(row) : null;
    }
    static async deleteOne(filter) {
      const entry = [...records.entries()].find(([, row]) => matches(row, filter));
      if (!entry) return { deletedCount: 0 };
      records.delete(entry[0]); writes += 1; return { deletedCount: 1 };
    }
    static async countDocuments(filter) { return [...records.values()].filter((row) => matches(row, filter)).length; }
    static async updateOne(filter, update, options = {}) {
      const row = [...records.values()].find((value) => matches(value, filter));
      if (!row && options.upsert) {
        const document = await this.create({ ...filter, ...update.$setOnInsert, ...update.$set });
        return { upsertedCount: 1, upsertedId: document._id };
      }
      if (row && update.$set) await new this({ ...row, ...update.$set }).save();
      return { upsertedCount: 0, matchedCount: row ? 1 : 0, modifiedCount: row && update.$set ? 1 : 0 };
    }
    static get records() { return records; }
    static get writes() { return writes; }
  }
  return MemoryModel;
}
module.exports = { memoryModel };
