//! SSE streaming helpers for real-time scenario execution.

use crate::runner::RunEvent;
use axum::response::sse::{Event, KeepAlive, Sse};
use std::convert::Infallible;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;

/// Convert a [`RunEvent`] receiver into an axum SSE response.
///
/// Each event is serialized as JSON in the SSE `data` field
/// with event type `"run_event"`.
pub fn run_event_stream(
    rx: mpsc::Receiver<RunEvent>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let stream = ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_else(|_| {
            r#"{"error":"serialization failed"}"#.to_string()
        });
        Ok(Event::default().event("run_event").data(data))
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}
