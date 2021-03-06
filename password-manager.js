"use strict";


/********* External Imports ********/

var lib = require("./lib");

var KDF = lib.KDF,
    HMAC = lib.HMAC,
    SHA256 = lib.SHA256,
    setup_cipher = lib.setup_cipher,
    enc_gcm = lib.enc_gcm,
    dec_gcm = lib.dec_gcm,
    bitarray_slice = lib.bitarray_slice,
    bitarray_to_string = lib.bitarray_to_string,
    string_to_bitarray = lib.string_to_bitarray,
    bitarray_to_hex = lib.bitarray_to_hex,
    hex_to_bitarray = lib.hex_to_bitarray,
    bitarray_to_base64 = lib.bitarray_to_base64,
    base64_to_bitarray = lib.base64_to_bitarray,
    byte_array_to_hex = lib.byte_array_to_hex,
    hex_to_byte_array = lib.hex_to_byte_array,
    string_to_padded_byte_array = lib.string_to_padded_byte_array,
    string_to_padded_bitarray = lib.string_to_padded_bitarray,
    string_from_padded_byte_array = lib.string_from_padded_byte_array,
    string_from_padded_bitarray = lib.string_from_padded_bitarray,
    random_bitarray = lib.random_bitarray,
    bitarray_equal = lib.bitarray_equal,
    bitarray_len = lib.bitarray_len,
    bitarray_concat = lib.bitarray_concat,
    dict_num_keys = lib.dict_num_keys;


/********* Implementation ********/


var keychain = function() {
  // Class-private instance variables.
  // local usage
  var priv = {
    secrets: { /* Your secrets here */ },
    data: { /* Non-secret data here */ }
  };

  // Maximum length of each record in bytes
  var MAX_PW_LEN_BYTES = 64;

  // Flag to indicate whether password manager is "ready" or not
  var ready = false;

  var keychain = {};

  /**
   * Creates an empty keychain with the given password. Once init is called,
   * the password manager should be in a ready state.
   *
   * Arguments:
   *   password: string
   * Return Type: void
   */
  keychain.init = function(password) {
    priv.data.version = "CS 255 Password Manager v1.0";
    var password_bitarray = string_to_bitarray(password);
    var master_salt = random_bitarray(128);
    var long_key = KDF(password_bitarray, master_salt);
    priv.secrets.master_key = bitarray_slice(long_key, 0, 128);
    keychain.master_salt = bitarray_to_base64(master_salt);

    var hmac_salt = random_bitarray(128);
    priv.secrets.hmac_key = bitarray_slice(
        SHA256(priv.secrets.master_key), 0, 128
        );
    keychain.hmac_salt = bitarray_to_base64(hmac_salt);

    // our "magic keyword, important later
    keychain.magic = bitarray_to_base64(
        enc_gcm(setup_cipher(priv.secrets.master_key),
          string_to_bitarray("Recurse"))
        );
    ready = true;
  };


  /**
   * Loads the keychain state from the provided representation (repr). The
   * repr variable will contain a JSON encoded serialization of the contents
   * of the KVS (as returned by the save function). The trusted_data_check
   * is an *optional* SHA-256 checksum that can be used to validate the
   * integrity of the contents of the KVS. If the checksum is provided and the
   * integrity check fails, an exception should be thrown. You can assume that
   * the representation passed to load is well-formed (e.g., the result of a
   * call to the save function). Returns true if the data is successfully loaded
   * and the provided password is correct. Returns false otherwise.
   *
   * Arguments:
   *   password:           string
   *   repr:               string
   *   trusted_data_check: string
   * Return Type: boolean
   */
  keychain.load = function(password, repr, trusted_data_check) {
    var store = string_to_bitarray(repr);
    if (trusted_data_check !== undefined &&
        bitarray_to_base64(SHA256(store)) != trusted_data_check)
      throw "SHA-256 validation failed!";
    else {
      var new_keychain = JSON.parse(repr);
      var password_key = bitarray_slice(
          KDF(string_to_bitarray(password),
            base64_to_bitarray(new_keychain.master_salt)), 0, 128
          );
      var plaintext = bitarray_to_string(
          dec_gcm(setup_cipher(password_key),
            base64_to_bitarray(new_keychain.magic))
          );
      if (plaintext === "Recurse")
      {
        priv.secrets.master_key = password_key;

        priv.secrets.hmac_key = bitarray_slice(
            SHA256(priv.secrets.master_key), 0, 128
            );
        keychain = new_keychain;

        ready = true;
      }
      else
      {
        ready = false;
      }
      return ready;
    }
  };

  /**
   * Returns a JSON serialization of the contents of the keychain that can be
   * loaded back using the load function. The return value should consist of
   * an array of two strings:
   *   arr[0] = JSON encoding of password manager
   *   arr[1] = SHA-256 checksum
   * As discussed in the handout, the first element of the array should contain
   * all of the data in the password manager. The second element is a SHA-256
   * checksum computed over the password manager to preserve integrity. If the
   * password manager is not in a ready-state, return null.
   *
   * Return Type: array
   */
  keychain.dump = function() {
    var encoded_store = JSON.stringify(keychain);
    var checksum = bitarray_to_base64(SHA256(string_to_bitarray(encoded_store)));
    return [encoded_store, checksum];
  };

  /**
   * Fetches the data (as a string) corresponding to the given domain from the KVS.
   * If there is no entry in the KVS that matches the given domain, then return
   * null. If the password manager is not in a ready state, throw an exception. If
   * tampering has been detected with the records, throw an exception.
   *
   * Arguments:
   *   name: string
   * Return Type: string
   */
  keychain.get = function(name) {
    if (!ready)
      throw "Keychain not initialized.";
    if (priv.secrets.hmac_key === undefined)
    {
      // i already have salts and password key
      var hmac_salt = random_bitarray(128);
      priv.secrets.hmac_key = bitarray_slice(SHA256(keychain.priv.secrets.master_key), 0, 128);
      keychain.hmac_salt = bitarray_to_base64(hmac_salt);

    }
    var name_digest = bitarray_to_base64(HMAC(priv.secrets.hmac_key, name));
    if (keychain[name_digest])
    {
      var plaintext = dec_gcm(setup_cipher(priv.secrets.master_key),
          base64_to_bitarray(keychain[name_digest]));
      return bitarray_to_string(plaintext);
    }
    else
      return null;
  };

  /**
   * Inserts the domain and associated data into the KVS. If the domain is
   * already in the password manager, this method should update its value. If
   * not, create a new entry in the password manager. If the password manager is
   * not in a ready state, throw an exception.
   *
   * Arguments:
   *   name: string
   *   value: string
   * Return Type: void
   */
  keychain.set = function(name, value) {
    if (!ready)
      throw "Keychain not initialized.";
    var name_digest = bitarray_to_base64(HMAC(priv.secrets.hmac_key, name));
    var enc_val = bitarray_to_base64(enc_gcm(setup_cipher(priv.secrets.master_key),
          string_to_bitarray(value)));
    keychain[name_digest] = enc_val;
  };

  /**
   * Removes the record with name from the password manager. Returns true
   * if the record with the specified name is removed, false otherwise. If
   * the password manager is not in a ready state, throws an exception.
   *
   * Arguments:
   *   name: string
   * Return Type: boolean
   */
  keychain.remove = function(name) {
    if (!ready)
      throw "Keychain not initialized.";
    var name_digest = bitarray_to_base64(HMAC(priv.secrets.hmac_key, name));
    if (keychain[name_digest]) {
      delete keychain[name_digest];
      return true;
    }
    else {
      return false;
    }
  };

  return keychain;
};

module.exports.keychain = keychain;
