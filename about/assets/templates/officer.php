<?php
  // This class can generate an officer block for the about and past officer pages
  // Created Nov 5 by Alexandra French
  // Last updated Nov 5 by Alexandra French

  class Officer{
  
    public function __construct() {
    }
    
    // generates an officer block
    // image, image alt, major, and description are all optional
    public function generateOfficer($name, $position, $image, $imageAlt, $major, $description) {
      echo "  <div class=\"people card-blk-wht h-100 text-center\">";
      // if theres an image (and image alt for accessibility), generate an image for the officer
      if ($image != null && $imageAlt != null) {
        echo "\n                <img class=\"card-img-top\" src=\"" . $image . "\" alt=\"" . $imageAlt . "\">";
      }
      echo "\n                <div class=\"card-body\">";
      echo "\n                  <h3 class=\"card-title\">" . $name . "</h3>";
      echo "\n                  <p class=\"card-subtitle mb-2\">" . $position . "</p>";
      
      // if major or description, use a card text
      if ($major != null or $description != null) {
        echo "\n                  <p class=\"card-text\">";
        // if major known, list it
        if ($major != null) {
          echo $major . "\n                    <br>";
        }
        // if description, give it
        if ($description != null) {
         echo "\n                    " . $description;
        }
        echo "\n                    </p>";
      }
      echo "\n                </div>\n              </div>\n";
    }
    
  }

?>
