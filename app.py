"""Serve the simulator page and expose the stateless JSON scheduling endpoint."""

from flask import Flask, Response, jsonify, request, send_from_directory

from engine import srtf

# CSRF review: no authentication/session cookies or persistent state changes.
# /simulate accepts JSON only; form submissions are rejected and CORS is not enabled.
# Revisit token protection if authenticated or state-changing routes are added.
app = Flask(__name__, static_folder="static", static_url_path="/static")  # NOSONAR(S4502)
app.json.sort_keys = False
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024


@app.errorhandler(413)
def request_too_large(error):
    return jsonify({"error": "Request body is too large (maximum 16 KB)."}), 413


@app.route("/", methods=["GET"])
def index() -> Response:
    """Serve the group's frontend from the configured static directory."""
    return send_from_directory("static", "index.html")


@app.route("/simulate", methods=["POST"])
def simulate() -> tuple[Response, int]:
    """Validate the JSON envelope and return scheduling results or a client error."""
    # Invalid JSON or a non-JSON content type becomes the same JSON error response.
    data = request.get_json(silent=True)

    # The contract requires an object containing the process's collection.
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    # Report a missing field separately from an invalid processes value.
    if "processes" not in data:
        return jsonify({"error": "Missing processes field."}), 400

    # The engine owns process validation, including count and timeline limits.
    try:
        result = srtf(data["processes"])
    except ValueError as error:
        # Expected input failures use the contract's HTTP 400 error envelope.
        return jsonify({"error": str(error)}), 400

    # Serialize the result without changing its steps, chart, or metric fields.
    return jsonify(result), 200


# Start the local server only when launched directly, not when imported by tests.
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
