// PRISM Kubernetes Integration Adapter
// Ingests Kubernetes pod restart events, OOMKilled events, and container crash loops into evidence

function parseKubernetesEvent(k8sPayload, investigationId) {
  const event = k8sPayload.involvedObject ? k8sPayload : (k8sPayload.object || k8sPayload);
  const reason = event.reason || k8sPayload.reason || 'PodCrashLoopBackOff';
  const podName = event.involvedObject?.name || event.metadata?.name || 'k8s-workload-unknown';
  const namespace = event.involvedObject?.namespace || event.metadata?.namespace || 'default';
  const message = event.message || k8sPayload.message || 'Kubernetes cluster state alert';

  const isOOM = reason.includes('OOM') || message.includes('OOMKilled');

  return {
    investigation_id: investigationId,
    type: isOOM ? 'METRIC_TRACE' : 'LOG_EVIDENCE',
    source: 'kubernetes',
    source_ref: `k8s/${namespace}/${podName}`,
    title: `Kubernetes Alert: ${reason} on ${podName}`,
    content: JSON.stringify({
      namespace,
      podName,
      reason,
      message,
      count: event.count || 1,
      firstTimestamp: event.firstTimestamp || new Date().toISOString(),
      lastTimestamp: event.lastTimestamp || new Date().toISOString(),
      sourceHost: event.source?.host || 'cluster-node'
    }, null, 2),
    reliability: 0.99,
    provenance: {
      provider: 'kubernetes',
      namespace,
      podName,
      reason
    }
  };
}

module.exports = { parseKubernetesEvent };
