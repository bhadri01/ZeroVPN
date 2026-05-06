use qrcode::{QrCode, render::svg};

pub fn render_svg(payload: &str) -> Result<String, qrcode::types::QrError> {
    let code = QrCode::new(payload.as_bytes())?;
    Ok(code
        .render::<svg::Color<'_>>()
        .min_dimensions(256, 256)
        .quiet_zone(true)
        .build())
}
