use thiserror::Error;
use tracing::info;
use zeromq::{Socket, SocketRecv, SubSocket};
use zerovpn_wire::Event;

#[derive(Debug, Error)]
pub enum SubError {
    #[error("zmq: {0}")]
    Zmq(#[from] zeromq::ZmqError),
    #[error("decode: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
    #[error("malformed frame")]
    Malformed,
}

pub struct Subscriber {
    socket: SubSocket,
}

impl Subscriber {
    pub async fn connect(endpoint: &str, topic_prefix: &str) -> Result<Self, SubError> {
        let mut socket = SubSocket::new();
        socket.connect(endpoint).await?;
        socket.subscribe(topic_prefix).await?;
        info!(endpoint, topic_prefix, "zmq subscriber connected");
        Ok(Self { socket })
    }

    pub async fn recv(&mut self) -> Result<(String, Event), SubError> {
        let msg = self.socket.recv().await?;
        let frames = msg.into_vec();
        if frames.len() < 2 {
            return Err(SubError::Malformed);
        }
        let topic = String::from_utf8_lossy(&frames[0]).into_owned();
        let event = zerovpn_wire::decode(&frames[1])?;
        Ok((topic, event))
    }
}
