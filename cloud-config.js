/* Lucca Cloud configuration. The anon key is public by design; never put service_role here. */
window.LUCCA_CLOUD_CONFIG = Object.assign({
  enabled: true,
  url: 'https://uudimvcdkaacqaxgajbk.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1ZGltdmNka2FhY3FheGdhamJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMzQ4MTYsImV4cCI6MjEwMjgxMDgxNn0.WrwCUlqWW2ib7D8T41DNzUbybo4FHnNQ1AIBTZr2ZlM',
  realtime: true,
  realtimeTables: ['orders', 'order_items', 'order_status_history', 'payments', 'tables_store', 'inventory', 'products', 'categories', 'expenses', 'refunds']
}, window.LUCCA_CLOUD_CONFIG || {});
