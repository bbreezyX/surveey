from getpass import getpass
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from survey.models import Account
from survey.services import audit

class Command(BaseCommand):
    help = 'Provision or reset an explicitly approved account. Passwords are entered privately, never CLI arguments.'
    def add_arguments(self, parser):
        parser.add_argument('username')
        parser.add_argument('--role', choices=['editor', 'publisher', 'owner'], required=True)
        parser.add_argument('--reset', action='store_true')
    def handle(self, **options):
        import re
        username = options['username']
        if len(username) > 150 or not re.fullmatch(r'[\w.@+-]+', username):
            raise CommandError('Invalid username.')
        account = Account.objects.filter(username=username).first()
        if account and not options['reset']:
            raise CommandError('Account exists. Use --reset only for an authorized recovery.')
        account = account or Account(username=username)
        if account.pk and account.role == 'owner' and options['role'] != 'owner' and Account.objects.filter(role='owner', is_active=True).count() <= 1:
            raise CommandError('Cannot demote the last owner.')
        password = getpass('New password (minimum 15 characters): ')
        if password != getpass('Confirm password: '):
            raise CommandError('Passwords do not match.')
        try:
            validate_password(password, account)
        except ValidationError as error:
            raise CommandError(' '.join(error.messages))
        with transaction.atomic():
            account.set_password(password)
            account.role, account.is_active = options['role'], True
            account.session_version += 1
            account.save()
            audit(None, 'account.operator_provisioned', account.pk, after={'username': username, 'role': account.role})
        self.stdout.write('Approved account provisioned. Existing sessions were revoked.')
