export class BlockedError extends Error {}
// Only temporary transport/loading failures may be retried automatically.
export class NetworkError extends Error {}
// Keadaan yang stabil dan tidak berubah walau diulang: layarnya harus dibereskan manusia di HP.
// Mencoba ulang hanya membuang waktu HP tanpa mengubah hasilnya.
export class ManualActionError extends Error {}
