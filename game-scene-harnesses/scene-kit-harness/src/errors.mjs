export class InvalidKit extends Error {
  constructor(errors) { super('Scene-kit contract validation failed'); this.errors = errors; }
}
export const reject = (code, artifact, path, message) => {
  throw new InvalidKit([{ code, artifact, path, message }]);
};
export const demand = (condition, code, artifact, path, message) => {
  if (!condition) reject(code, artifact, path, message);
};
export const uniqueIds = (entries, field, artifact, path) => {
  const ids = new Set();
  entries.forEach((entry, index) => {
    demand(!ids.has(entry[field]), 'DUPLICATE_ID', artifact, `${path}/${index}/${field}`, 'ID must be unique in its scope');
    ids.add(entry[field]);
  });
};
export const uniqueInstances = (groups, artifact) => {
  const ids = new Set();
  for (const [entries, path] of groups) entries.forEach((entry, index) => {
    demand(!ids.has(entry.instanceId), 'DUPLICATE_ID', artifact, `${path}/${index}/instanceId`, 'Instance ID must be unique across objects and assemblies');
    ids.add(entry.instanceId);
  });
};
