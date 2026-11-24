<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Schema\ColumnType;
use OCP\DB\Types;

/**
 * A `betteroffice_sessions` row: the authoritative record of one document's
 * collaboration room (PLAN.md §10). Room epoch and save-lease state are
 * deliberately not modelled here yet -- see the migration's own header
 * comment for why.
 *
 * @method string getInstanceId()
 * @method void setInstanceId(string $instanceId)
 * @method int getFileId()
 * @method void setFileId(int $fileId)
 * @method string getFormat()
 * @method void setFormat(string $format)
 * @method string getRoomId()
 * @method void setRoomId(string $roomId)
 * @method string getInitialEtag()
 * @method void setInitialEtag(string $initialEtag)
 * @method string|null getSavedEtag()
 * @method void setSavedEtag(?string $savedEtag)
 * @method string|null getSeed()
 * @method void setSeed(?string $seed)
 * @method string getStatus()
 * @method void setStatus(string $status)
 * @method \DateTimeImmutable getCreatedAt()
 * @method void setCreatedAt(\DateTimeImmutable $createdAt)
 * @method \DateTimeImmutable getUpdatedAt()
 * @method void setUpdatedAt(\DateTimeImmutable $updatedAt)
 */
class Session extends Entity {
	protected $instanceId;
	protected $fileId;
	protected $format;
	protected $roomId;
	protected $initialEtag;
	protected $savedEtag;
	protected $seed;
	protected $status;
	protected $createdAt;
	protected $updatedAt;

	public function __construct() {
		$this->addType('instanceId', Types::STRING);
		$this->addType('fileId', Types::BIGINT);
		$this->addType('format', Types::STRING);
		$this->addType('roomId', Types::STRING);
		$this->addType('initialEtag', Types::STRING);
		$this->addType('savedEtag', Types::STRING);
		$this->addType('seed', ColumnType::Blob);
		$this->addType('status', Types::STRING);
		$this->addType('createdAt', Types::DATETIME_IMMUTABLE);
		$this->addType('updatedAt', Types::DATETIME_IMMUTABLE);
	}
}
