use thiserror::Error;
use tracing::info;
use zeromq::{PubSocket, Socket, SocketSend, ZmqMessage};
use zerovpn_wire::Event;

#[derive(Debug, Error)]
pub enum PubError {
    #[error("zmq: {0}")]
    Zmq(#[from] zeromq::ZmqError),
    #[error("encode: {0}")]
    Encode(#[from] rmp_serde::encode::Error),
}

pub struct Publisher {
    socket: PubSocket,
}

impl Publisher {
    pub async fn bind(endpoint: &str) -> Result<Self, PubError> {
        let mut socket = PubSocket::new();
        socket.bind(endpoint).await?;
        info!(endpoint, "zmq publisher bound");
        Ok(Self { socket })
    }

    pub async fn publish(&mut self, topic: &str, event: &Event) -> Result<(), PubError> {
        let body = zerovpn_wire::encode(event)?;
        let mut msg = ZmqMessage::from(topic.as_bytes().to_vec());
        msg.push_back(body.into());
        self.socket.send(msg).await?;
        Ok(())
    }
}
