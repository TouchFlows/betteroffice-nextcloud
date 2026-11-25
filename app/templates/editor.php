<?php
/**
 * @var array $_
 * @var \OCP\IL10N $l
 */
?>
<div
	id="betteroffice-editor"
	data-file-id="<?php p($_['fileId']); ?>"
	data-file-name="<?php p($_['fileName']); ?>"
	data-read-only="<?php p($_['readOnly'] ? '1' : '0'); ?>"
	data-relay-url="<?php p($_['relayUrl']); ?>"
></div>
