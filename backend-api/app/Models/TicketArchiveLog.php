<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Immutable archive log entry for completed tickets (Phase 5).
 * Once written, records are never updated — tamper-proof audit trail.
 */
class TicketArchiveLog extends Model
{
    protected $primaryKey = 'archive_id';

    // Explicitly disable auto-timestamps since this table is immutable.
    public $timestamps = false;

    protected $fillable = [
        'ticket_id',
        'vehicle_id',
        'ticket_title',
        'vehicle_name',
        'plate_number',
        'final_status',
        'maintenance_cost',
        'full_ticket_snapshot',
        'archived_by',
        'archived_at',
    ];

    protected $casts = [
        'full_ticket_snapshot' => 'array',
        'archived_at'          => 'datetime',
    ];

    public function ticket()
    {
        return $this->belongsTo(MaintenanceTicket::class, 'ticket_id', 'ticket_id');
    }

    public function vehicle()
    {
        return $this->belongsTo(Vehicle::class, 'vehicle_id', 'vehicle_id');
    }

    public function archivedBy()
    {
        return $this->belongsTo(User::class, 'archived_by');
    }
}
