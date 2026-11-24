/* Lucca Cloud Live: one Supabase channel, one event contract for every screen. */
(function () {
  'use strict';
  const config = window.LUCCA_CLOUD_CONFIG || {};
  const tables = Array.isArray(config.realtimeTables) ? config.realtimeTables : [];
  let channel = null;
  let clientRef = null;
  let started = false;
  let stopped = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  const MAX_BACKOFF_MS = 60000;

  function emit(name, detail) {
    if (typeof window === 'undefined' || !window.dispatchEvent) return;
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function teardownChannel() {
    if (!channel) return;
    try {
      if (clientRef && typeof clientRef.removeChannel === 'function') {
        clientRef.removeChannel(channel);
      } else if (typeof channel.unsubscribe === 'function') {
        channel.unsubscribe();
      }
    } catch (e) { /* القناة قد تكون مُغلقة بالفعل */ }
    channel = null;
  }

  // إعادة الاشتراك تلقائياً بتراجع أسّي: سابقاً كان أي CHANNEL_ERROR/CLOSED
  // يُسكت التحديثات الحية نهائياً حتى إعادة تشغيل التطبيق.
  function scheduleReconnect() {
    if (stopped || !clientRef || reconnectTimer) return;
    reconnectAttempts += 1;
    const backoff = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, reconnectAttempts - 1));
    const delay = backoff + Math.floor(Math.random() * 500);
    emit('lucca:cloud-status', { status: 'reconnecting', attempt: reconnectAttempts, delayMs: delay });
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      subscribe();
    }, delay);
  }

  function subscribe() {
    if (stopped || !clientRef) return;
    teardownChannel();
    channel = clientRef.channel('lucca-live-pos');
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
      if (status === 'SUBSCRIBED') {
        reconnectAttempts = 0;
        emit('lucca:cloud-status', { status: 'connected' });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        emit('lucca:cloud-status', { status: 'error', error: error ? String(error.message || error) : status });
        scheduleReconnect();
      } else if (status === 'CLOSED') {
        emit('lucca:cloud-status', { status: 'disconnected' });
        if (!stopped) scheduleReconnect();
      }
    });
  }

  // عند عودة الشبكة: أعد الاشتراك فوراً بدل انتظار مؤقّت التراجع.
  function onOnline() {
    if (!started || stopped || !clientRef) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    subscribe();
  }

  function start(client) {
    if (started || config.enabled === false || !client || config.realtime === false || !tables.length) return;
    started = true;
    stopped = false;
    clientRef = client;
    reconnectAttempts = 0;
    emit('lucca:cloud-status', { status: 'connecting' });
    subscribe();
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', onOnline);
    }
  }

  function stop() {
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    teardownChannel();
    started = false;
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('online', onOnline);
    }
    emit('lucca:cloud-status', { status: 'disconnected' });
  }

  window.LuccaCloudLive = { start: start, stop: stop, isStarted: function () { return started; } };
})();
