//! GeoIP enrichment using MaxMind GeoLite2 database.
//!
//! This module provides lookup of IP addresses to geographic coordinates and
//! country/city information. It's designed to enrich flow records with location
//! data at ingest time.

use std::net::IpAddr;
use std::sync::Arc;

use maxminddb::Reader;
use serde::{Deserialize, Serialize};

/// Geographic information for an IP address.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoInfo {
    pub latitude: f64,
    pub longitude: f64,
    pub country_code: String,
    pub country_name: String,
    pub city_name: Option<String>,
}

/// GeoIP database reader. Thread-safe wrapper around MaxMind reader.
pub struct GeoReader {
    reader: Arc<Reader<Vec<u8>>>,
}

impl GeoReader {
    /// Load a MaxMind GeoLite2 database from a file path.
    ///
    /// # Errors
    /// Returns an error if the database file cannot be read or parsed.
    pub fn new(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let data = std::fs::read(path)?;
        let reader = Reader::from_source(data)?;
        Ok(GeoReader {
            reader: Arc::new(reader),
        })
    }

    /// Look up geographic information for an IP address.
    ///
    /// Returns `None` if the IP is not found in the database (private ranges,
    /// reserved addresses, etc.) or if the database lacks the necessary fields.
    pub fn lookup(&self, ip: &str) -> Option<GeoInfo> {
        let ip_addr: IpAddr = ip.parse().ok()?;
        let value: serde_json::Value = self.reader.lookup(ip_addr).ok()?;

        // Extract country info
        let country = value.get("country")?;
        let country_code = country
            .get("iso_code")
            .and_then(|v| v.as_str())
            .unwrap_or("XX")
            .to_string();

        let country_name = country
            .get("names")
            .and_then(|names| names.get("en"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())?;

        // Extract location (coordinates)
        let location = value.get("location")?;
        let latitude = location.get("latitude").and_then(|v| v.as_f64())?;
        let longitude = location.get("longitude").and_then(|v| v.as_f64())?;

        // Extract city name (optional)
        let city_name = value
            .get("city")
            .and_then(|city| city.get("names"))
            .and_then(|names| names.get("en"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Some(GeoInfo {
            latitude,
            longitude,
            country_code,
            country_name,
            city_name,
        })
    }
}

impl Clone for GeoReader {
    fn clone(&self) -> Self {
        GeoReader {
            reader: Arc::clone(&self.reader),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_geo_info_serialization() {
        let geo = GeoInfo {
            latitude: 37.7749,
            longitude: -122.4194,
            country_code: "US".to_string(),
            country_name: "United States".to_string(),
            city_name: Some("San Francisco".to_string()),
        };

        let json = serde_json::to_string(&geo).unwrap();
        let deserialized: GeoInfo = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.latitude, 37.7749);
        assert_eq!(deserialized.country_code, "US");
    }
}
