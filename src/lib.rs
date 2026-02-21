//! TODO: add English documentation
//!
//! TODO: add English documentation
//! TODO: add English documentation

pub mod api_client;
pub mod config;
pub mod markdown_parser;
pub mod model;
pub mod runner;
pub mod sse;
pub mod validator;

pub use config::*;
pub use model::*;
pub use runner::*;
pub use validator::*;

/// TODO: add English documentation
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn add(left: u64, right: u64) -> u64 {
    left + right
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::{
        HttpMethod, HttpRequest, ResponseExpectation, TestScenario,
        TestStep,
    };
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn test_scenario_serialization() {
        // TODO: add English comment
        let scenario = TestScenario {
            name: "テストシナリオ".to_string(),
            description: Some("これはテストシナリオです".to_string()),
            steps: vec![TestStep {
                id: None,
                name: "ステップ1".to_string(),
                description: Some("これはステップ1です".to_string()),
                request: HttpRequest {
                    method: HttpMethod::Get,
                    url: "http://example.com/api/test".to_string(),
                    headers: HashMap::new(),
                    query: HashMap::new(),
                    body: None,
                },
                expect: ResponseExpectation {
                    status: 200,
                    headers: HashMap::new(),
                    json: HashMap::new(),
                    json_lengths: HashMap::new(),
                    schema: None,
                    contains: vec![],
                    json_eq: None,
                    json_ignore_fields: vec![],
                    sse: None,
                },
                save: HashMap::new(),
                condition: None,
            }],
            vars: HashMap::new(),
            config: model::TestConfig {
                base_url: None,
                headers: HashMap::new(),
                timeout: 30,
                continue_on_failure: false,
            },
        };

        // TODO: add English comment
        let yaml = scenario.to_yaml().unwrap();

        // TODO: add English comment
        let deserialized = TestScenario::from_yaml(&yaml).unwrap();

        // TODO: add English comment
        assert_eq!(scenario.name, deserialized.name);
        assert_eq!(scenario.steps.len(), deserialized.steps.len());
        assert_eq!(scenario.steps[0].name, deserialized.steps[0].name);
    }

    #[test]
    fn test_json_validation() {
        let json_str = r#"{"name":"テスト","data":{"value":123,"nested":{"foo":"bar"}}}"#;

        // TODO: add English comment
        let mut expectations = HashMap::new();
        expectations.insert("name".to_string(), json!("テスト"));
        expectations.insert("data.value".to_string(), json!(123));
        expectations.insert("data.nested.foo".to_string(), json!("bar"));

        // TODO: add English comment
        let errors =
            validator::validate_json(json_str, &expectations).unwrap();
        assert!(errors.is_empty());

        // TODO: add English comment
        let mut fail_expectations = HashMap::new();
        fail_expectations.insert("name".to_string(), json!("違う名前"));

        let errors =
            validator::validate_json(json_str, &fail_expectations).unwrap();
        assert!(!errors.is_empty());
    }
}
