<?php
  // This class can generate an officer block for the about and past officer pages
  // Created Nov 9 by Alexandra French
  // Last updated Nov 9 by Alexandra French
  
  class Sponsor {
  
    public function __construct() {
    }
    
    
    public function generateSponsor($name, $image, $imageAlt, $description, $link) {
      echo "\n        <div class=\"sponsors card-blk-wht h-100\">";
      echo "\n            <h2 class=\"card-header\">" . $name . "</h2>";
      echo "\n            <img class=\"card-img-top\" src=\"" . $image . "\" alt=\"" . $imageAlt . "\">";
      echo "\n            <div class=\"card-body\">";
      echo "\n              <p class=\"card-subtitle mb-2\">" . $description . "</p>";
      echo "\n            </div>
              <div class=\"card-footer\">";
      echo "\n              <a href=\"" . $link . "\" class=\"btn btn-light\">Visit " . $name . "</a>";
      echo "\n            </div>
            </div>";
    }
  
  }

?>
