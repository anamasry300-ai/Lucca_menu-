/* Lucca Cloud Live: one Supabase channel, one event contract for every screen. */
(function () {
  'use strict';
  const config = window.LUCCA_CLOUD_CONFIG || {};
  const tables = Array.isArray(config.realtimeTables) ? config.realtimeTables : [];
  let channel = null;
  let started = false;

  function emit(name, detail) {
    if (typeof window === 'undefined' || !window.dispatchEvent) return;
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function start(client) {
    if (started || config.enabled === false || !client || config.realtime === false || !tables.length) return;
    started = true;
    emit('lucca:cloud-status', { status: 'connecting' });
    channel = client.channel('lucca-live-pos');
    tables.forEach(function (table) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: table }, function (payload) {
        emit('lucca:cloud-change', {
          table: table,
          event: payload && payload.eventType ? payload.eventType : 'UPDATE',
          record: payload && payload.new ? payload.new : null,
          oldRecord: payload && payload.old ? payload.old : null,
          receivedAt: new Date().toISOString()
        });
      });
    });
    channel.subscribe(function (status, error) {
      if (status === 'SUBSCRIBED') emit('lucca:cloud-status', { status: 'connected' });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        emit('lucca:cloud-status', { status: 'error', error: error ? String(error.message || error) : status });
      } else if (status === 'CLOSED') emit('lucca:cloud-status', { status: 'disconnected' });
    });
  }

  function stop() {
    if (channel && typeof channel.unsubscribe === 'function') channel.unsubscribe();
    channel = null;
    started = false;
    emit('lucca:cloud-status', { status: 'disconnected' });
  }

  window.LuccaCloudLive = { start: start, stop: stop, isStarted: function () { return started; } };
})();
