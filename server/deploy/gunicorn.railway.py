# Only the local request-size-limited Caddy sidecar can connect to this socket.
# It replaces X-Survey-Proto; caller-supplied forwarding headers are ignored.
bind = '127.0.0.1:9000'
workers = 2
threads = 1
timeout = 60
forwarded_allow_ips = '127.0.0.1,::1'
secure_scheme_headers = {'X-SURVEY-PROTO': 'https'}
limit_request_line = 4094
limit_request_fields = 40
limit_request_field_size = 8190
accesslog = '-'
errorlog = '-'
control_socket_disable = True
