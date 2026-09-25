//! Vérifications contre l'environnement réel : l'API OVH et le trousseau du
//! système. Ignorées par défaut — elles sortent de la machine.
//!
//! `cargo test --test live -- --ignored`

use ovh_desktop_lib::ovh::endpoint::Endpoint;
use ovh_desktop_lib::ovh::OvhClient;

#[tokio::test]
#[ignore = "réseau"]
async fn sync_time_reaches_the_eu_api() {
    let client = OvhClient::new(Endpoint::OvhEu, "O.V.H./test").expect("client");
    let delta = client.sync_time().await.expect("GET /auth/time");
    // Un écart de plus d'une minute ferait rejeter nos signatures.
    assert!(delta.abs() < 60, "écart d'horloge suspect: {delta}s");
}

#[test]
#[ignore = "trousseau"]
fn secret_store_round_trips() {
    // Service dédié au test : ne touche pas l'entrée réelle de l'application.
    let entry = keyring::Entry::new("O.V.H. selftest", "probe").expect("entrée");
    entry.set_password("valeur-de-test").expect("écriture");
    assert_eq!(entry.get_password().expect("lecture"), "valeur-de-test");
    entry.delete_credential().expect("suppression");
}
