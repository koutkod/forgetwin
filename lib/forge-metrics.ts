export const SUPPORTED_METRIC_KEYS = [
  'payload_capacity', 'lift_height', 'stability_margin', 'placement_error', 'peak_acceleration',
  'span', 'load_capacity', 'deflection', 'safety_factor', 'speed_ratio', 'output_torque',
  'output_speed', 'transmission_efficiency', 'reach', 'joint_margin', 'course_time',
  'platform_tilt', 'traction_margin', 'tracking_error', 'actuator_count', 'response_time',
  'throughput', 'sorting_accuracy', 'collisions', 'drop_height', 'control_error',
  'assembly_integrity', 'component_count', 'flow_rate', 'angular_travel',
  'alignment_error', 'clamp_force',
  'plate_count', 'port_count',
] as const;

export type SupportedMetricKey = (typeof SUPPORTED_METRIC_KEYS)[number];
export const SUPPORTED_METRICS: ReadonlySet<string> = new Set(SUPPORTED_METRIC_KEYS);
