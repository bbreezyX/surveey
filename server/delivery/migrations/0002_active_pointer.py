from django.db import migrations

def initialize(apps, schema_editor):
    apps.get_model('delivery', 'ActivePublication').objects.get_or_create(id=1)

class Migration(migrations.Migration):
    dependencies = [('delivery', '0001_initial')]
    operations = [migrations.RunPython(initialize, migrations.RunPython.noop)]
