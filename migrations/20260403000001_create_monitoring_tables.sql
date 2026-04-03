-- monitoring_runs: stores each scenario execution record.
CREATE TABLE IF NOT EXISTS monitoring_runs (
    id              VARCHAR(36) NOT NULL,
    scenario_id     VARCHAR(255) NOT NULL,
    scenario_name   VARCHAR(255) NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    success         TINYINT(1),
    error           TEXT,
    result_json     JSON,
    duration_ms     BIGINT UNSIGNED,
    started_at      DATETIME(3) NOT NULL,
    finished_at     DATETIME(3),
    created_at      DATETIME(3) NOT NULL
                        DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    INDEX idx_monitoring_runs_scenario (scenario_id),
    INDEX idx_monitoring_runs_started  (started_at),
    INDEX idx_monitoring_runs_status   (status)
);

-- monitoring_schedules: cron-based recurring run config.
CREATE TABLE IF NOT EXISTS monitoring_schedules (
    id              VARCHAR(36)   NOT NULL,
    name            VARCHAR(255)  NOT NULL,
    scenario_id     VARCHAR(255)  NOT NULL,
    scenario_path   VARCHAR(1024) NOT NULL,
    cron_expression VARCHAR(100)  NOT NULL,
    enabled         TINYINT(1)    NOT NULL DEFAULT 1,
    last_run_id     VARCHAR(36),
    last_run_at     DATETIME(3),
    created_at      DATETIME(3)   NOT NULL
                        DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)   NOT NULL
                        DEFAULT CURRENT_TIMESTAMP(3)
                        ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    INDEX idx_monitoring_schedules_enabled (enabled),
    INDEX idx_monitoring_schedules_scenario (scenario_id)
);
