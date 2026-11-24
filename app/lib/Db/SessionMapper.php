<?php

declare(strict_types=1);

namespace OCA\BetterOffice\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<Session> */
class SessionMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'betteroffice_sessions', Session::class);
	}

	/** @throws DoesNotExistException */
	public function findByIdentity(string $instanceId, int $fileId, string $format): Session {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from($this->getTableName())
			->where($query->expr()->eq('instance_id', $query->createNamedParameter($instanceId)))
			->andWhere($query->expr()->eq('file_id', $query->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
			->andWhere($query->expr()->eq('format', $query->createNamedParameter($format)));

		return $this->findEntity($query);
	}

	/**
	 * Atomic create-if-absent for the room seed (§8.2 steps 4-6): sets the
	 * seed only if this session doesn't already have one. Returns whether
	 * *this* call is the one that set it -- false means another caller won
	 * the race first, and the session's current (authoritative) seed
	 * should be read back instead of trusting the bytes this call offered.
	 */
	public function trySetSeed(int $id, string $seed): bool {
		$query = $this->db->getQueryBuilder();
		$query->update($this->getTableName())
			->set('seed', $query->createNamedParameter($seed, IQueryBuilder::PARAM_LOB))
			->where($query->expr()->eq('id', $query->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->andWhere($query->expr()->isNull('seed'));

		return $query->executeStatement() > 0;
	}
}
