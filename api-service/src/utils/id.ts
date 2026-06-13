// Short random hex id (pipeline UIDs, login session ids, …).
export function hexId(len: number): string {
  let s = '';
  while (s.length < len) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, len);
}
